import {
  CopyObjectCommand,
  DeleteObjectCommand,
  DeleteObjectsCommand,
  GetObjectCommand,
  ListObjectsV2Command,
  PutObjectCommand,
  S3Client,
} from "@aws-sdk/client-s3";
import type { GetObjectCommandOutput } from "@aws-sdk/client-s3";
import { Upload } from "@aws-sdk/lib-storage";
import { Readable, pipeline } from "stream";
import { BlobServiceClient, ContainerClient, StorageSharedKeyCredential } from "@azure/storage-blob";
import type { BlobDownloadResponseParsed } from "@azure/storage-blob";
import { Inject, Injectable, Optional } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { randomUUID } from "crypto";
import { ClsService } from "nestjs-cls";
import { S3_KEY_ACCESS_POLICY, S3KeyAccessPolicy } from "../../../common/interfaces/s3.key-access.policy.interface";
import { BaseConfigInterface, ConfigApiInterface, ConfigS3Interface } from "../../../config/interfaces";
import { JsonApiService } from "../../../core/jsonapi/services/jsonapi.service";
import { AppLoggingService } from "../../../core/logging/services/logging.service";
import { S3Model } from "../../s3/entities/s3.model";
import { S3_OBJECTS_SEGMENT, s3Meta } from "../../s3/entities/s3.meta";
import {
  S3_ENCRYPTION_METADATA_KEY,
  S3_ENCRYPTION_METADATA_VALUE,
  S3_OBJECT_TOKEN_TTL_SECONDS,
  S3CipherKeyMissingError,
  isEncryptedObjectMetadata,
} from "../cipher/s3-cipher.core";
import { S3CipherService } from "./s3-cipher.service";
import { JsonApiSingleDocument } from "../../../core/jsonapi/interfaces/jsonapi.document.interface";

/**
 * Timeouts for every S3-compatible client; without them a request on a dead keep-alive socket waits forever.
 * socketTimeout stays under 6000 ms: @smithy/node-http-handler defers a larger one by 3 s and drops it when headers arrive first, leaving the body read unguarded.
 * throwOnRequestTimeout is required: without it a breached requestTimeout only logs a warning and the request keeps waiting.
 */
const S3_CONNECTION_TIMEOUT_MS = 10_000;
const S3_SOCKET_TIMEOUT_MS = 5_000;
const S3_REQUEST_TIMEOUT_MS = 300_000;
const S3_REQUEST_HANDLER = {
  connectionTimeout: S3_CONNECTION_TIMEOUT_MS,
  socketTimeout: S3_SOCKET_TIMEOUT_MS,
  requestTimeout: S3_REQUEST_TIMEOUT_MS,
  throwOnRequestTimeout: true,
};

@Injectable()
export class S3Service {
  private s3Client: S3Client;
  private blobServiceClient: BlobServiceClient;
  private containerClient: ContainerClient;
  private _bucket: string;
  private _endpoint: string;
  private _storageType: string;

  constructor(
    private readonly builder: JsonApiService,
    private readonly clsService: ClsService,
    private readonly configService: ConfigService<BaseConfigInterface>,
    private readonly logger: AppLoggingService,
    private readonly cipher: S3CipherService,
    @Optional()
    @Inject(S3_KEY_ACCESS_POLICY)
    private readonly keyPolicy?: S3KeyAccessPolicy,
  ) {}

  private get s3Config(): ConfigS3Interface {
    return this.configService.get<ConfigS3Interface>("s3");
  }

  /** Token-verified api URL served by S3Controller: `${api.url}s3/objects/<token>`. */
  private _apiObjectUrl(token: string): string {
    return `${this.configService.get<ConfigApiInterface>("api").url}${s3Meta.endpoint}/${S3_OBJECTS_SEGMENT}/${token}`;
  }

  /** Object metadata flag for an encrypted write, or undefined when the key is stored as plaintext. */
  private _metadataFor(key: string): Record<string, string> | undefined {
    return this.cipher.shouldEncrypt(key) ? { [S3_ENCRYPTION_METADATA_KEY]: S3_ENCRYPTION_METADATA_VALUE } : undefined;
  }

  /** Body and metadata to write for `key`: ciphertext plus the flag when encrypting, the buffer untouched otherwise. */
  private async _prepareBody(
    key: string,
    buffer: Buffer,
  ): Promise<{ body: Buffer; metadata: Record<string, string> | undefined }> {
    const metadata = this._metadataFor(key);
    if (!metadata) return { body: buffer, metadata: undefined };

    return { body: await this.cipher.encrypt(buffer), metadata };
  }

  /** Throws when a flagged object cannot be opened: ciphertext is never returned to a caller. */
  private _assertCanDecrypt(key: string): void {
    if (!this.cipher.canDecrypt) throw new S3CipherKeyMissingError([], key);
  }

  /** The cipher does not know the storage key; name it in a missing-key error. */
  private _withObjectKey(error: unknown, key: string): unknown {
    if (error instanceof S3CipherKeyMissingError && !error.objectKey) {
      return new S3CipherKeyMissingError(error.keyIds, key);
    }
    return error;
  }

  /** Decrypts the stored bytes when the object metadata (S3 `Metadata` / Azure `metadata`) carries the flag. */
  private async _readBody(key: string, metadata: Record<string, string> | undefined, bytes: Buffer): Promise<Buffer> {
    if (!isEncryptedObjectMetadata(metadata)) return bytes;

    this._assertCanDecrypt(key);
    try {
      return await this.cipher.decrypt(bytes);
    } catch (error) {
      throw this._withObjectKey(error, key);
    }
  }

  /** Streaming counterpart of `_readBody`: a flagged object is piped through the cipher's decrypt stream. */
  private _readStream(key: string, metadata: Record<string, string> | undefined, stream: Readable): Readable {
    if (!isEncryptedObjectMetadata(metadata)) return stream;

    this._assertCanDecrypt(key);
    const decrypting = this.cipher.decryptStream();
    pipeline(stream, decrypting, (error) => {
      if (error) this.logger.error(`Failed to decrypt object stream ${key}`, this._withObjectKey(error, key) as Error);
    });
    return decrypting;
  }

  /**
   * `_readStream`, but for a flagged object it waits for the first decrypted chunk (or the end), so a
   * failure before any byte (a key that is not configured) rejects here, before a response starts,
   * instead of breaking a response that is already under way.
   */
  private async _readStreamReady(
    key: string,
    metadata: Record<string, string> | undefined,
    body: Readable,
  ): Promise<Readable> {
    const stream = this._readStream(key, metadata, body);
    if (stream === body) return stream;

    try {
      return await new Promise<Readable>((resolve, reject) => {
        const cleanup = () => {
          stream.off("data", onData);
          stream.off("end", onEnd);
          stream.off("error", onError);
        };
        const onData = (chunk: Buffer) => {
          cleanup();
          stream.pause();
          stream.unshift(chunk);
          resolve(stream);
        };
        const onEnd = () => {
          cleanup();
          resolve(Readable.from([]));
        };
        const onError = (error: Error) => {
          cleanup();
          reject(error);
        };
        stream.on("data", onData);
        stream.on("end", onEnd);
        stream.on("error", onError);
      });
    } catch (error) {
      throw this._withObjectKey(error, key);
    }
  }

  private async _streamToBuffer(stream: AsyncIterable<Uint8Array | string>): Promise<Buffer> {
    const chunks: Buffer[] = [];
    for await (const chunk of stream) {
      chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
    }
    return Buffer.concat(chunks);
  }

  private async _loadConfiguration(): Promise<void> {
    const type = this.s3Config.type;

    this._storageType = type;

    switch (type) {
      case "s3":
        this._bucket = this.s3Config.bucket;
        this._endpoint = `https://${this._bucket}.s3.amazonaws.com/`;
        this.s3Client = new S3Client({
          region: this.s3Config.region,
          credentials: {
            accessKeyId: this.s3Config.key,
            secretAccessKey: this.s3Config.secret,
          },
          requestHandler: S3_REQUEST_HANDLER,
        });
        break;
      case "digitalocean":
      case "hetzner":
        this._bucket = this.s3Config.bucket;
        this._endpoint = `https://${this._bucket}.${this.s3Config.endpoint.split("//")[1]}/`;
        this.s3Client = new S3Client({
          region: this.s3Config.region,
          endpoint: this.s3Config.endpoint,
          credentials: {
            accessKeyId: this.s3Config.key,
            secretAccessKey: this.s3Config.secret,
          },
          requestHandler: S3_REQUEST_HANDLER,
        });
        break;
      case "minio":
        this._bucket = this.s3Config.bucket;
        this._endpoint = `${this.s3Config.endpoint}${this._bucket}/`;
        this.s3Client = new S3Client({
          endpoint: this.s3Config.endpoint,
          region: "local",
          credentials: {
            accessKeyId: this.s3Config.key,
            secretAccessKey: this.s3Config.secret,
          },
          forcePathStyle: true,
          requestHandler: S3_REQUEST_HANDLER,
        });
        break;
      case "azure":
        this._bucket = this.s3Config.bucket;
        const connectionString = this.s3Config.key;

        try {
          // Parse connection string to extract account name and key for SAS generation
          const accountNameMatch = connectionString.match(/AccountName=([^;]+)/);
          const accountKeyMatch = connectionString.match(/AccountKey=([^;]+)/);

          if (accountNameMatch && accountKeyMatch) {
            const accountName = accountNameMatch[1];
            const accountKey = accountKeyMatch[1];

            // Create shared key credential for SAS token generation
            const sharedKeyCredential = new StorageSharedKeyCredential(accountName, accountKey);
            this._endpoint = `https://${accountName}.blob.core.windows.net/`;
            this.blobServiceClient = new BlobServiceClient(this._endpoint, sharedKeyCredential);
          } else {
            // Fallback to connection string method (might not support SAS generation)
            this.blobServiceClient = BlobServiceClient.fromConnectionString(connectionString);
            const accountNameMatch = connectionString.match(/AccountName=([^;]+)/);
            const accountName = accountNameMatch ? accountNameMatch[1] : "unknown";
            this._endpoint = `https://${accountName}.blob.core.windows.net/`;
          }
        } catch (error) {
          throw new Error(`Invalid Azure connection string: ${error.message}`);
        }

        this.containerClient = this.blobServiceClient.getContainerClient(this._bucket);
        break;
    }
  }

  async generatePresignedUrl(params: {
    key: string;
    contentType: string;
    ttl?: 3600;
    isPublic: boolean;
    /** Per-token upload limit; the object route enforces the smaller of it and the global cap. */
    maxBytes?: number;
  }): Promise<JsonApiSingleDocument | null> {
    await this._loadConfiguration();

    if (!this._endpoint) return null;

    // Uploads always go through the api: S3Controller writes the bytes, encrypting them when
    // `shouldEncrypt`, passing them through otherwise. Put tokens are not windowed.
    const token = this.cipher.signObjectToken({
      op: "put",
      key: params.key,
      contentType: params.contentType,
      maxBytes: params.maxBytes,
      expiresInSeconds: S3_OBJECT_TOKEN_TTL_SECONDS,
    });

    const data = {
      id: randomUUID(),
      url: this._apiObjectUrl(token),
      storageType: "api",
      contentType: params.contentType,
      blobType: undefined,
      acl: undefined,
      createdAt: new Date(),
      updatedAt: new Date(),
    };

    return this.builder.buildSingle(S3Model, data);
  }

  async deleteFolderFromS3(params: { key: string }): Promise<void> {
    await this._loadConfiguration();
    if (!this._endpoint) return null;

    if (this._storageType === "azure") return await this._deleteAzureFolder(params);

    const prefix = params.key.endsWith("/") ? params.key : `${params.key}/`;

    try {
      let continuationToken: string | undefined;

      do {
        const listCommand = new ListObjectsV2Command({
          Bucket: this._bucket,
          Prefix: prefix,
          ContinuationToken: continuationToken,
        });

        const listResponse = await this.s3Client.send(listCommand);

        if (listResponse.Contents && listResponse.Contents.length > 0) {
          const objectsToDelete = listResponse.Contents.map((obj) => ({
            Key: obj.Key!,
          }));

          const deleteCommand = new DeleteObjectsCommand({
            Bucket: this._bucket,
            Delete: {
              Objects: objectsToDelete,
            },
          });

          await this.s3Client.send(deleteCommand);
        }

        continuationToken = listResponse.NextContinuationToken;
      } while (continuationToken);
    } catch (error) {
      this.logger.error(`Failed to delete folder with prefix ${prefix}`, error);
    }
  }

  private async _deleteAzureFolder(params: { key: string }): Promise<void> {
    const prefix = params.key.endsWith("/") ? params.key : `${params.key}/`;

    try {
      const blobs = this.containerClient.listBlobsFlat({ prefix });

      for await (const blob of blobs) {
        const blobClient = this.containerClient.getBlobClient(blob.name);
        await blobClient.delete();
      }
    } catch (error) {
      this.logger.error(`Failed to delete Azure folder with prefix ${prefix}`, error);
    }
  }

  async deleteFileFromS3(params: { key: string }): Promise<void> {
    await this._loadConfiguration();
    if (!this._endpoint) return null;

    if (this._storageType === "azure") return await this._deleteAzureFile(params);

    const command = new DeleteObjectCommand({
      Bucket: this._bucket,
      Key: params.key,
    });

    try {
      await this.s3Client.send(command);
    } catch (error) {
      this.logger.error(`Failed to delete file with key ${params.key}`, error);
    }
  }

  private async _deleteAzureFile(params: { key: string }): Promise<void> {
    try {
      const blobClient = this.containerClient.getBlobClient(params.key);
      await blobClient.delete();
    } catch (error) {
      this.logger.error(`Failed to delete Azure file with key ${params.key}`, error);
    }
  }

  /**
   * Builds an RFC 6266 `attachment` Content-Disposition value. The ASCII fallback strips
   * characters that would break the header (quotes, path separators, control chars) while
   * `filename*` carries the original UTF-8 name for browsers that support it.
   */
  contentDispositionAttachment(filename: string): string {
    return this._contentDisposition("attachment", filename);
  }

  /**
   * Inline disposition named after the last segment of the key: the browser still renders the file
   * in place (PDF previews), but saving it uses the real file name instead of the token in the URL.
   */
  contentDispositionInline(key: string): string {
    const segment = key.split("/").pop() || key;
    let filename = segment;
    try {
      filename = decodeURIComponent(segment);
    } catch {
      // Not URI-encoded: keep the raw segment.
    }

    return this._contentDisposition("inline", filename);
  }

  /**
   * Inline disposition under a given file name: the browser still renders the file in place, but
   * saving it uses that name. Same encoding as `contentDispositionAttachment`.
   */
  contentDispositionInlineFilename(filename: string): string {
    return this._contentDisposition("inline", filename);
  }

  private _contentDisposition(type: "attachment" | "inline", filename: string): string {
    const ascii = filename.replace(/[^\x20-\x7e]/g, "_").replace(/["\\/\r\n]/g, "_");

    return `${type}; filename="${ascii}"; filename*=UTF-8''${encodeURIComponent(filename)}`;
  }

  async findSignedUrl(params: { key: string; isPublic?: boolean; filename?: string }): Promise<JsonApiSingleDocument> {
    await this._loadConfiguration();
    const signedUrl = await this.generateSignedUrl(params);

    const data = {
      id: randomUUID(),
      url: signedUrl,
      createdAt: new Date(),
      updatedAt: new Date(),
    };

    return this.builder.buildSingle(S3Model, data);
  }

  async generateSignedUrl(params: {
    key: string;
    ttl?: number;
    isPublic?: boolean;
    filename?: string;
    /** Serve inline under `filename` instead of as an attachment; ignored without a filename. */
    inline?: boolean;
  }): Promise<string> {
    await this._loadConfiguration();
    if (!this._endpoint) return null;

    // Downloads always go through the api, for every key; the api decrypts flagged objects and
    // passes the rest through. The expiry is anchored to the start of the current signing window
    // so the same key yields the same URL for the whole window and browser/image caches can hit;
    // the window is added so the URL stays valid for at least the requested ttl from now.
    // Public assets get no expiry, but only for keys the bound policy allows to be permanent: any
    // other key silently gets a normal expiring link (serialisers call this and must not throw).
    const permanent = params.isPublic === true && this._mayBePermanent(params.key);
    const token = this.cipher.signObjectToken({
      op: "get",
      key: params.key,
      filename: params.filename,
      inline: params.inline,
      expiresAt: permanent ? undefined : this._windowedExpiry(params.ttl ?? S3_OBJECT_TOKEN_TTL_SECONDS),
    });

    return this._apiObjectUrl(token);
  }

  /** True unless a bound policy implements `isPermanentKey` and rejects `key`. */
  private _mayBePermanent(key: string): boolean {
    if (!this.keyPolicy?.isPermanentKey) return true;
    return this.keyPolicy.isPermanentKey(key);
  }

  /** Unix seconds: start of the current signing window + ttl + window (`s3.signingWindowSeconds`, default 3600). */
  private _windowedExpiry(ttl: number): number {
    const configuredWindow = this.s3Config.signingWindowSeconds;
    const windowSeconds = configuredWindow > 0 ? configuredWindow : 3600;
    const windowStart = Math.floor(Math.floor(Date.now() / 1000) / windowSeconds) * windowSeconds;

    return windowStart + ttl + windowSeconds;
  }

  async uploadFile(params: {
    buffer: Buffer;
    key: string;
    contentType?: string;
  }): Promise<{ fileUrl: string; filePath: string }> {
    await this._loadConfiguration();
    if (!this._endpoint) return null;

    if (this._storageType === "azure") return await this._uploadAzureFile(params);

    const fileContentType =
      params.contentType || (await this.getContentType(params.buffer)) || "application/octet-stream";

    // Strip parameters (e.g. "; charset=utf-8") for extension lookup
    const baseContentType = fileContentType.split(";")[0].trim();

    // Map specific MIME types to preferred extensions.
    const extensionMapping: Record<string, string> = {
      "application/vnd.openxmlformats-officedocument.wordprocessingml.document": "docx",
      "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet": "xlsx",
      "application/vnd.openxmlformats-officedocument.presentationml.presentation": "pptx",
      "application/pdf": "pdf",
      "text/plain": "txt",
      "text/markdown": "md",
      "text/vtt": "vtt",
    };

    const extension =
      extensionMapping[baseContentType] || (baseContentType.includes("/") ? baseContentType.split("/")[1] : "bin");

    const finalKey = `${params.key}.${extension}`;

    try {
      const { body, metadata } = await this._prepareBody(finalKey, params.buffer);
      await this.s3Client.send(
        new PutObjectCommand({
          Bucket: this._bucket,
          Key: finalKey,
          Body: body,
          ContentType: fileContentType,
          Metadata: metadata,
        }),
      );
    } catch (error) {
      this.logger.error("File upload error", error);
      throw error;
    }

    const fileUrl = await this.generateSignedUrl({ key: finalKey });
    return { filePath: finalKey, fileUrl };
  }

  private async _uploadAzureFile(params: {
    buffer: Buffer;
    key: string;
    contentType?: string;
  }): Promise<{ fileUrl: string; filePath: string }> {
    const fileContentType =
      params.contentType || (await this.getContentType(params.buffer)) || "application/octet-stream";

    // Strip parameters (e.g. "; charset=utf-8") for extension lookup
    const baseContentType = fileContentType.split(";")[0].trim();

    // Map specific MIME types to preferred extensions.
    const extensionMapping: Record<string, string> = {
      "application/vnd.openxmlformats-officedocument.wordprocessingml.document": "docx",
      "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet": "xlsx",
      "application/vnd.openxmlformats-officedocument.presentationml.presentation": "pptx",
      "application/pdf": "pdf",
      "text/plain": "txt",
      "text/markdown": "md",
      "text/vtt": "vtt",
    };

    const extension =
      extensionMapping[baseContentType] || (baseContentType.includes("/") ? baseContentType.split("/")[1] : "bin");

    const finalKey = `${params.key}.${extension}`;

    try {
      const { body, metadata } = await this._prepareBody(finalKey, params.buffer);
      const blobClient = this.containerClient.getBlockBlobClient(finalKey);
      await blobClient.upload(body, body.length, {
        blobHTTPHeaders: {
          blobContentType: fileContentType,
        },
        metadata,
      });

      const fileUrl = await this.generateSignedUrl({ key: finalKey });
      return { filePath: finalKey, fileUrl };
    } catch (error) {
      this.logger.error("Azure file upload error", error);
      throw error;
    }
  }

  async uploadImageBuffer(params: { buffer: Buffer; key: string }): Promise<{ imageUrl: string; imagePath: string }> {
    await this._loadConfiguration();
    if (!this._endpoint) return null;

    if (this._storageType === "azure") return await this._uploadAzureImage(params);

    const contentType = await this.getContentType(params.buffer);
    if (!contentType) {
      throw new Error("Unsupported image format");
    }

    const finalKey = `${params.key}.${contentType.split("/")[1]}`;

    try {
      const { body, metadata } = await this._prepareBody(finalKey, params.buffer);
      await this.s3Client.send(
        new PutObjectCommand({
          Bucket: this._bucket,
          Key: finalKey,
          Body: body,
          ContentType: contentType,
          Metadata: metadata,
        }),
      );
    } catch (error) {
      this.logger.error("Image upload error", error);
    }

    const publicUrl = await this.generateSignedUrl({ key: finalKey });
    return { imagePath: finalKey, imageUrl: publicUrl };
  }

  private async _uploadAzureImage(params: {
    buffer: Buffer;
    key: string;
  }): Promise<{ imageUrl: string; imagePath: string }> {
    const contentType = await this.getContentType(params.buffer);
    if (!contentType) {
      throw new Error("Unsupported image format");
    }

    const finalKey = `${params.key}.${contentType.split("/")[1]}`;

    try {
      const { body, metadata } = await this._prepareBody(finalKey, params.buffer);
      const blobClient = this.containerClient.getBlockBlobClient(finalKey);
      await blobClient.upload(body, body.length, {
        blobHTTPHeaders: {
          blobContentType: contentType,
        },
        metadata,
      });

      const publicUrl = await this.generateSignedUrl({ key: finalKey });
      return { imagePath: finalKey, imageUrl: publicUrl };
    } catch (error) {
      this.logger.error("Azure image upload error", error);
      throw error;
    }
  }

  private async getContentType(buffer: Buffer): Promise<string | null> {
    await this._loadConfiguration();
    if (!this._endpoint) return null;

    const header = buffer.subarray(0, 4).toString("hex").toLowerCase();

    const magicNumbers: Record<string, string> = {
      "89504e47": "image/png", // PNG
      ffd8ffe0: "image/jpeg", // JPEG
      ffd8ffe1: "image/jpeg",
      ffd8ffe2: "image/jpeg",
      "0000000c": "image/jp2", // JPEG 2000
      "47494638": "image/gif", // GIF
      "49492a00": "image/tiff", // TIFF (little endian)
      "4d4d002a": "image/tiff", // TIFF (big endian)
      "52494646": "image/webp", // WebP (RIFF)
      "424d": "image/bmp", // BMP
    };

    // Return the MIME type if the header matches
    return magicNumbers[header] || null;
  }

  async uploadToAzureFromBuffer(params: {
    buffer: Buffer;
    key: string;
    contentType: string;
  }): Promise<{ fileUrl: string; filePath: string }> {
    await this._loadConfiguration();

    if (this._storageType !== "azure") {
      throw new Error("This method is only for Azure storage");
    }

    const finalKey = params.key;

    try {
      const { body, metadata } = await this._prepareBody(finalKey, params.buffer);
      const blobClient = this.containerClient.getBlockBlobClient(finalKey);
      await blobClient.upload(body, body.length, {
        blobHTTPHeaders: {
          blobContentType: params.contentType,
        },
        metadata,
      });

      const fileUrl = await this.generateSignedUrl({ key: finalKey });
      return { filePath: finalKey, fileUrl };
    } catch (error) {
      this.logger.error("Azure direct upload error", error);
      throw error;
    }
  }

  async uploadToS3(params: { buffer: Buffer; key: string; contentType: string; isPublic?: boolean }): Promise<void> {
    await this._loadConfiguration();
    if (!this._endpoint) return;

    const { body, metadata } = await this._prepareBody(params.key, params.buffer);

    if (this._storageType === "azure") {
      const blobClient = this.containerClient.getBlockBlobClient(params.key);
      await blobClient.upload(body, body.length, {
        blobHTTPHeaders: { blobContentType: params.contentType },
        metadata,
      });
      return;
    }

    const command = new PutObjectCommand({
      Bucket: this._bucket,
      Key: params.key,
      Body: body,
      ContentType: params.contentType,
      ACL: params.isPublic ? "public-read" : undefined,
      Metadata: metadata,
    });

    await this.s3Client.send(command);
  }

  async getObjectContent(params: { key: string }): Promise<string> {
    await this._loadConfiguration();
    if (!this._endpoint) return null;

    if (this._storageType === "azure") {
      return await this._getAzureObjectContent(params);
    }

    const command = new GetObjectCommand({
      Bucket: this._bucket,
      Key: params.key,
    });

    try {
      const response = await this.s3Client.send(command);
      const bytes = await this._streamToBuffer(response.Body as AsyncIterable<Uint8Array>);
      return (await this._readBody(params.key, response.Metadata, bytes)).toString("utf-8");
    } catch (error) {
      console.error(`Failed to get object content for key ${params.key}:`, error);
      throw error;
    }
  }

  private async _getAzureObjectContent(params: { key: string }): Promise<string> {
    try {
      const blobClient = this.containerClient.getBlobClient(params.key);
      const downloadResponse = await blobClient.download();
      const bytes = await this._streamToBuffer(downloadResponse.readableStreamBody as AsyncIterable<Buffer>);
      return (await this._readBody(params.key, downloadResponse.metadata, bytes)).toString("utf-8");
    } catch (error) {
      console.error(`Failed to get Azure object content for key ${params.key}:`, error);
      throw error;
    }
  }

  /**
   * Single-page list for streaming consumers. Unlike listObjects (which accumulates every page
   * into one array), this returns one page plus the continuation token so the caller can resume
   * on demand. StartAfter lets a caller resume after a known key; it is ignored when
   * ContinuationToken is set.
   */
  async listObjectsPage(params: {
    prefix: string;
    startAfter?: string;
    continuationToken?: string;
    maxKeys?: number;
  }): Promise<{ objects: { key: string; size: number }[]; nextContinuationToken?: string }> {
    await this._loadConfiguration();
    if (!this._endpoint) return { objects: [] };
    if (this._storageType === "azure") {
      throw new Error("listObjectsPage is not supported for azure storage");
    }

    const listResponse = await this.s3Client.send(
      new ListObjectsV2Command({
        Bucket: this._bucket,
        Prefix: params.prefix,
        StartAfter: params.continuationToken ? undefined : params.startAfter,
        ContinuationToken: params.continuationToken,
        MaxKeys: params.maxKeys,
      }),
    );

    const objects: { key: string; size: number }[] = [];
    for (const obj of listResponse.Contents ?? []) {
      if (obj.Key && obj.Size !== undefined) objects.push({ key: obj.Key, size: obj.Size });
    }
    return { objects, nextContinuationToken: listResponse.NextContinuationToken };
  }

  /**
   * Download a file from S3/Azure and return both its buffer and the response Content-Type.
   * Used by workers that hash + re-upload while preserving the original content type.
   */
  async downloadFileBuffer(params: { key: string }): Promise<{ buffer: Buffer; contentType?: string }> {
    await this._loadConfiguration();
    if (!this._endpoint) {
      throw new Error("S3 not configured");
    }

    if (this._storageType === "azure") {
      const blobClient = this.containerClient.getBlobClient(params.key);
      const downloadResponse = await blobClient.download();
      if (!downloadResponse.readableStreamBody) {
        throw new Error(`Azure blob not found: ${params.key}`);
      }
      const bytes = await this._streamToBuffer(downloadResponse.readableStreamBody);
      return {
        buffer: await this._readBody(params.key, downloadResponse.metadata, bytes),
        contentType: downloadResponse.contentType ?? undefined,
      };
    }

    const command = new GetObjectCommand({
      Bucket: this._bucket,
      Key: params.key,
    });
    const response = await this.s3Client.send(command);
    if (!response.Body) {
      throw new Error(`S3 object not found: ${params.key}`);
    }
    const bytes = await this._streamToBuffer(response.Body as AsyncIterable<Uint8Array>);
    return {
      buffer: await this._readBody(params.key, response.Metadata, bytes),
      contentType: response.ContentType,
    };
  }

  /**
   * Upload a readable stream with an exact key using multipart upload.
   * Unlike uploadBufferWithKey, this streams data without holding the full content in memory.
   */
  async uploadStream(params: { key: string; contentType: string; stream: Readable }): Promise<void> {
    await this._loadConfiguration();
    if (!this._endpoint) return;

    const metadata = this._metadataFor(params.key);
    let body: Readable = params.stream;
    if (metadata) {
      const encrypting = this.cipher.encryptStream();
      pipeline(params.stream, encrypting, (error) => {
        if (error) this.logger.error(`Failed to encrypt object stream ${params.key}`, error);
      });
      body = encrypting;
    }

    if (this._storageType === "azure") {
      const blobClient = this.containerClient.getBlockBlobClient(params.key);
      await blobClient.uploadStream(body, 8 * 1024 * 1024, 4, {
        blobHTTPHeaders: { blobContentType: params.contentType },
        metadata,
      });
      return;
    }

    // S3-compatible storage — multipart upload via @aws-sdk/lib-storage
    const upload = new Upload({
      client: this.s3Client,
      params: {
        Bucket: this._bucket,
        Key: params.key,
        Body: body,
        ContentType: params.contentType,
        Metadata: metadata,
      },
      partSize: 10 * 1024 * 1024,
      queueSize: 4,
    });

    await upload.done();
  }

  /**
   * Copy a file from one location to another within the same bucket/container.
   * Supports both S3-compatible storage and Azure Blob Storage.
   */
  async copyFile(params: { sourceKey: string; destinationKey: string }): Promise<void> {
    await this._loadConfiguration();
    if (!this._endpoint) return;

    if (this._storageType === "azure") {
      const sourceBlobClient = this.containerClient.getBlobClient(params.sourceKey);
      const destBlobClient = this.containerClient.getBlobClient(params.destinationKey);
      const copyPoller = await destBlobClient.beginCopyFromURL(sourceBlobClient.url);
      await copyPoller.pollUntilDone();
      return;
    }

    // S3-compatible storage (AWS, DigitalOcean, Hetzner, MinIO)
    const command = new CopyObjectCommand({
      Bucket: this._bucket,
      CopySource: `${this._bucket}/${params.sourceKey}`,
      Key: params.destinationKey,
    });

    await this.s3Client.send(command);
  }

  /**
   * List all objects under a given prefix.
   * Handles pagination for S3-compatible storage and Azure.
   */
  async listObjects(params: { prefix: string }): Promise<{ key: string; size: number }[]> {
    await this._loadConfiguration();
    if (!this._endpoint) return [];

    if (this._storageType === "azure") return await this._listAzureObjects(params);

    const results: { key: string; size: number }[] = [];
    let continuationToken: string | undefined;

    do {
      const listResponse = await this.s3Client.send(
        new ListObjectsV2Command({
          Bucket: this._bucket,
          Prefix: params.prefix,
          ContinuationToken: continuationToken,
        }),
      );

      if (listResponse.Contents) {
        for (const obj of listResponse.Contents) {
          if (obj.Key && obj.Size !== undefined) {
            results.push({ key: obj.Key, size: obj.Size });
          }
        }
      }

      continuationToken = listResponse.NextContinuationToken;
    } while (continuationToken);

    return results;
  }

  private async _listAzureObjects(params: { prefix: string }): Promise<{ key: string; size: number }[]> {
    const results: { key: string; size: number }[] = [];
    const blobs = this.containerClient.listBlobsFlat({ prefix: params.prefix });

    for await (const blob of blobs) {
      results.push({
        key: blob.name,
        size: blob.properties.contentLength ?? 0,
      });
    }

    return results;
  }

  /**
   * Download a file from S3/Azure and return its content as a string.
   * Useful for reading JSON or HTML content stored in object storage.
   */
  async downloadFileAsString(params: { key: string }): Promise<string | null> {
    await this._loadConfiguration();
    if (!this._endpoint) return null;

    if (this._storageType === "azure") {
      return await this._downloadAzureFileAsString(params);
    }

    let response: GetObjectCommandOutput;
    try {
      response = await this.s3Client.send(new GetObjectCommand({ Bucket: this._bucket, Key: params.key }));
    } catch (error) {
      this.logger.error(`Failed to download file ${params.key}`, error);
      return null;
    }
    if (!response.Body) return null;
    if (!isEncryptedObjectMetadata(response.Metadata)) return await response.Body.transformToString();

    const bytes = Buffer.from(await response.Body.transformToByteArray());
    return (await this._readBody(params.key, response.Metadata, bytes)).toString("utf-8");
  }

  private async _downloadAzureFileAsString(params: { key: string }): Promise<string | null> {
    let downloadResponse: BlobDownloadResponseParsed;
    let bytes: Buffer;
    try {
      const blobClient = this.containerClient.getBlobClient(params.key);
      downloadResponse = await blobClient.download();
      if (!downloadResponse.readableStreamBody) return null;
      bytes = await this._streamToBuffer(downloadResponse.readableStreamBody);
    } catch (error) {
      this.logger.error(`Failed to download Azure file ${params.key}`, error);
      return null;
    }
    return (await this._readBody(params.key, downloadResponse.metadata, bytes)).toString("utf-8");
  }

  /**
   * Download a file from S3/Azure and return its content as a Buffer.
   * Useful for reading binary files like attachments.
   */
  async downloadFileAsBuffer(params: { key: string }): Promise<Buffer | null> {
    await this._loadConfiguration();
    if (!this._endpoint) return null;

    if (this._storageType === "azure") {
      return await this._downloadAzureFileAsBuffer(params);
    }

    let response: GetObjectCommandOutput;
    let bytes: Buffer;
    try {
      response = await this.s3Client.send(new GetObjectCommand({ Bucket: this._bucket, Key: params.key }));
      if (!response.Body) return null;
      bytes = Buffer.from(await response.Body.transformToByteArray());
    } catch (error) {
      this.logger.error(`Failed to download file as buffer ${params.key}`, error);
      return null;
    }
    return await this._readBody(params.key, response.Metadata, bytes);
  }

  private async _downloadAzureFileAsBuffer(params: { key: string }): Promise<Buffer | null> {
    let downloadResponse: BlobDownloadResponseParsed;
    let bytes: Buffer;
    try {
      const blobClient = this.containerClient.getBlobClient(params.key);
      downloadResponse = await blobClient.download();
      if (!downloadResponse.readableStreamBody) return null;
      bytes = await this._streamToBuffer(downloadResponse.readableStreamBody);
    } catch (error) {
      this.logger.error(`Failed to download Azure file as buffer ${params.key}`, error);
      return null;
    }
    return await this._readBody(params.key, downloadResponse.metadata, bytes);
  }

  /**
   * Download a file from S3/Azure and return a readable stream.
   * Memory-efficient for large files like ZIP archives.
   */
  async downloadFileAsStream(params: { key: string }): Promise<Readable | null> {
    await this._loadConfiguration();
    if (!this._endpoint) return null;

    if (this._storageType === "azure") {
      return await this._downloadAzureFileAsStream(params);
    }

    let response: GetObjectCommandOutput;
    try {
      const command = new GetObjectCommand({
        Bucket: this._bucket,
        Key: params.key,
      });

      response = await this.s3Client.send(command);
    } catch (error) {
      this.logger.error(`Failed to download file as stream ${params.key}`, error);
      return null;
    }
    if (!response.Body) return null;

    // AWS SDK v3 Body is SdkStream which extends Readable
    return this._readStream(params.key, response.Metadata, response.Body as Readable);
  }

  /**
   * Stream an object for the token-verified api route. Returns null when the object does not exist;
   * a flagged object comes back decrypted, and throws when no configured key can open it.
   */
  async downloadObject(params: { key: string }): Promise<{ stream: Readable; contentType?: string } | null> {
    await this._loadConfiguration();
    if (!this._endpoint) return null;

    if (this._storageType === "azure") {
      let downloadResponse: BlobDownloadResponseParsed;
      try {
        downloadResponse = await this.containerClient.getBlobClient(params.key).download();
      } catch (error) {
        if (error?.statusCode === 404) return null;
        throw error;
      }
      if (!downloadResponse.readableStreamBody) return null;

      return {
        stream: await this._readStreamReady(
          params.key,
          downloadResponse.metadata,
          downloadResponse.readableStreamBody as Readable,
        ),
        contentType: downloadResponse.contentType ?? undefined,
      };
    }

    let response: GetObjectCommandOutput;
    try {
      response = await this.s3Client.send(new GetObjectCommand({ Bucket: this._bucket, Key: params.key }));
    } catch (error) {
      if (error?.name === "NoSuchKey" || error?.name === "NotFound" || error?.$metadata?.httpStatusCode === 404)
        return null;
      throw error;
    }
    if (!response.Body) return null;

    return {
      stream: await this._readStreamReady(params.key, response.Metadata, response.Body as Readable),
      contentType: response.ContentType,
    };
  }

  private async _downloadAzureFileAsStream(params: { key: string }): Promise<Readable | null> {
    let downloadResponse: BlobDownloadResponseParsed;
    try {
      const blobClient = this.containerClient.getBlobClient(params.key);
      downloadResponse = await blobClient.download();
    } catch (error) {
      this.logger.error(`Failed to download Azure file as stream ${params.key}`, error);
      return null;
    }
    if (!downloadResponse.readableStreamBody) return null;

    return this._readStream(params.key, downloadResponse.metadata, downloadResponse.readableStreamBody as Readable);
  }

  /**
   * Upload a buffer with an exact key — NO extension appending.
   * Unlike uploadFile (which adds .pdf, .zip, etc.), this method
   * preserves the key exactly as provided.
   */
  async uploadBufferWithKey(params: { buffer: Buffer; key: string; contentType: string }): Promise<void> {
    await this._loadConfiguration();
    if (!this._endpoint) return;

    const { body, metadata } = await this._prepareBody(params.key, params.buffer);

    if (this._storageType === "azure") {
      const blobClient = this.containerClient.getBlockBlobClient(params.key);
      await blobClient.upload(body, body.length, {
        blobHTTPHeaders: { blobContentType: params.contentType },
        metadata,
      });
      return;
    }

    await this.s3Client.send(
      new PutObjectCommand({
        Bucket: this._bucket,
        Key: params.key,
        Body: body,
        ContentType: params.contentType,
        Metadata: metadata,
      }),
    );
  }
}
