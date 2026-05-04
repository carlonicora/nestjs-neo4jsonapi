import {
  DeleteObjectCommand,
  DeleteObjectsCommand,
  GetObjectCommand,
  ListObjectsV2Command,
  PutObjectCommand,
  S3Client,
} from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";
import {
  BlobSASPermissions,
  BlobServiceClient,
  ContainerClient,
  SASProtocol,
  StorageSharedKeyCredential,
  generateBlobSASQueryParameters,
} from "@azure/storage-blob";
import { Injectable } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { randomUUID } from "crypto";
import { ClsService } from "nestjs-cls";
import { BaseConfigInterface, ConfigS3Interface } from "../../../config/interfaces";
import { JsonApiDataInterface } from "../../../core/jsonapi/interfaces/jsonapi.data.interface";
import { JsonApiService } from "../../../core/jsonapi/services/jsonapi.service";
import { S3Model } from "../../s3/entities/s3.model";

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
  ) {}

  private get s3Config(): ConfigS3Interface {
    return this.configService.get<ConfigS3Interface>("s3");
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

  private async _prepareUrl(params: { key: string; contentType: string; isPublic?: boolean }): Promise<string> {
    if (this._storageType === "azure") return await this._prepareAzureUrl(params);

    const isPublic = params.isPublic ?? false;

    const command = isPublic
      ? new PutObjectCommand({
          Bucket: this._bucket,
          Key: params.key,
          ContentType: params.contentType,
          ACL: "public-read",
        })
      : new PutObjectCommand({
          Bucket: this._bucket,
          ContentType: params.contentType,
          Key: params.key,
        });

    const signedUrl = await getSignedUrl(this.s3Client, command, {
      expiresIn: 12 * 60 * 60,
    });

    return signedUrl;
  }

  private async _prepareAzureUrl(params: { key: string; contentType: string; isPublic?: boolean }): Promise<string> {
    const blobClient = this.containerClient.getBlockBlobClient(params.key);

    // For Azure, we need to check if we have shared key credentials to generate SAS
    const credential = this.blobServiceClient.credential;

    if (credential instanceof StorageSharedKeyCredential) {
      const sasToken = generateBlobSASQueryParameters(
        {
          containerName: this._bucket,
          blobName: params.key,
          permissions: BlobSASPermissions.parse("racw"), // Read, Add, Create, Write permissions
          startsOn: new Date(new Date().valueOf() - 15 * 60 * 1000), // Start 15 minutes ago to account for clock skew
          expiresOn: new Date(new Date().valueOf() + 12 * 60 * 60 * 1000), // 12 hours from now
          protocol: SASProtocol.Https,
          contentType: params.contentType, // This helps Azure validate the content type
        },
        credential,
      );

      return `${blobClient.url}?${sasToken}`;
    } else {
      // If we don't have shared key credentials, we can't generate SAS tokens
      // This would happen if using connection string with SAS or other auth methods
      throw new Error("Cannot generate SAS token: Shared key credentials required for presigned URLs");
    }
  }

  async generatePresignedUrl(params: {
    key: string;
    contentType: string;
    ttl?: 3600;
    isPublic: boolean;
  }): Promise<string> {
    await this._loadConfiguration();

    if (!this._endpoint) return null;
    const signedUrl = await this._prepareUrl(params);

    const data = {
      id: randomUUID(),
      url: signedUrl,
      storageType: this._storageType,
      contentType: params.contentType,
      blobType: this._storageType === "azure" ? "BlockBlob" : undefined,
      acl: this._storageType !== "azure" && params.isPublic ? "public-read" : undefined,
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
      console.error(`Failed to delete folder with prefix ${prefix}:`, error);
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
      console.error(`Failed to delete Azure folder with prefix ${prefix}:`, error);
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
      console.error(`Failed to delete file with key ${params.key}:`, error);
    }
  }

  private async _deleteAzureFile(params: { key: string }): Promise<void> {
    try {
      const blobClient = this.containerClient.getBlobClient(params.key);
      await blobClient.delete();
    } catch (error) {
      console.error(`Failed to delete Azure file with key ${params.key}:`, error);
    }
  }

  async findSignedUrl(params: { key: string; isPublic?: boolean }): Promise<JsonApiDataInterface> {
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

  async generateSignedUrl(params: { key: string; ttl?: number; isPublic?: boolean }): Promise<string> {
    await this._loadConfiguration();
    if (!this._endpoint) return null;

    if (this._storageType === "azure") return await this._generateAzureSignedUrl(params);

    try {
      if (params.isPublic) {
        return `${this._endpoint}${params.key}`;
      } else {
        const command = new GetObjectCommand({
          Bucket: this._bucket,
          Key: params.key,
        });

        const signedUrl = await getSignedUrl(this.s3Client, command, {
          expiresIn: params.ttl ?? 12 * 60 * 60,
        });

        return signedUrl;
      }
    } catch (error) {
      throw new Error(`Failed to generate URL: ${error.message}`);
    }
  }

  private async _generateAzureSignedUrl(params: { key: string; ttl?: number; isPublic?: boolean }): Promise<string> {
    try {
      const blobClient = this.containerClient.getBlobClient(params.key);

      if (params.isPublic) {
        return blobClient.url;
      } else {
        // Check if we have shared key credentials to generate SAS
        const credential = this.blobServiceClient.credential;

        if (credential instanceof StorageSharedKeyCredential) {
          const sasToken = generateBlobSASQueryParameters(
            {
              containerName: this._bucket,
              blobName: params.key,
              permissions: BlobSASPermissions.parse("r"), // Read permission
              startsOn: new Date(new Date().valueOf() - 15 * 60 * 1000), // Start 15 minutes ago to account for clock skew
              expiresOn: new Date(new Date().valueOf() + (params.ttl ?? 12 * 60 * 60) * 1000),
              protocol: SASProtocol.Https,
            },
            credential,
          );

          return `${blobClient.url}?${sasToken}`;
        } else {
          // If no shared key credentials, return the blob URL (works if container is public)
          return blobClient.url;
        }
      }
    } catch (error) {
      throw new Error(`Failed to generate Azure URL: ${error.message}`);
    }
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
      extensionMapping[fileContentType] || (fileContentType.includes("/") ? fileContentType.split("/")[1] : "bin");

    const finalKey = `${params.key}.${extension}`;

    const presignedUrl = await this._prepareUrl({
      key: finalKey,
      contentType: fileContentType,
    });

    try {
      await fetch(presignedUrl, {
        method: "PUT",
        body: new Uint8Array(params.buffer),
        headers: {
          "Content-Type": fileContentType,
        },
      });
    } catch (error) {
      console.error("File upload error:", error);
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
      extensionMapping[fileContentType] || (fileContentType.includes("/") ? fileContentType.split("/")[1] : "bin");

    const finalKey = `${params.key}.${extension}`;

    try {
      const blobClient = this.containerClient.getBlockBlobClient(finalKey);
      await blobClient.upload(params.buffer, params.buffer.length, {
        blobHTTPHeaders: {
          blobContentType: fileContentType,
        },
      });

      const fileUrl = await this.generateSignedUrl({ key: finalKey });
      return { filePath: finalKey, fileUrl };
    } catch (error) {
      console.error("Azure file upload error:", error);
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

    const presignedUrl = await this._prepareUrl({
      key: finalKey,
      contentType: contentType,
    });

    try {
      await fetch(presignedUrl, {
        method: "PUT",
        body: new Uint8Array(params.buffer),
        headers: {
          "Content-Type": contentType,
        },
      });
    } catch (error) {
      console.error(error);
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
      const blobClient = this.containerClient.getBlockBlobClient(finalKey);
      await blobClient.upload(params.buffer, params.buffer.length, {
        blobHTTPHeaders: {
          blobContentType: contentType,
        },
      });

      const publicUrl = await this.generateSignedUrl({ key: finalKey });
      return { imagePath: finalKey, imageUrl: publicUrl };
    } catch (error) {
      console.error("Azure image upload error:", error);
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
      const blobClient = this.containerClient.getBlockBlobClient(finalKey);
      await blobClient.upload(params.buffer, params.buffer.length, {
        blobHTTPHeaders: {
          blobContentType: params.contentType,
        },
      });

      const fileUrl = await this.generateSignedUrl({ key: finalKey });
      return { filePath: finalKey, fileUrl };
    } catch (error) {
      console.error("Azure direct upload error:", error);
      throw error;
    }
  }

  async uploadToS3(params: { buffer: Buffer; key: string; contentType: string; isPublic?: boolean }): Promise<void> {
    await this._loadConfiguration();
    if (!this._endpoint) return;

    if (this._storageType === "azure") {
      const blobClient = this.containerClient.getBlockBlobClient(params.key);
      await blobClient.upload(params.buffer, params.buffer.length, {
        blobHTTPHeaders: { blobContentType: params.contentType },
      });
      return;
    }

    const command = new PutObjectCommand({
      Bucket: this._bucket,
      Key: params.key,
      Body: params.buffer,
      ContentType: params.contentType,
      ACL: params.isPublic ? "public-read" : undefined,
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
      const stream = response.Body as NodeJS.ReadableStream;
      const chunks: Buffer[] = [];
      for await (const chunk of stream) {
        chunks.push(Buffer.from(chunk));
      }
      return Buffer.concat(chunks).toString("utf-8");
    } catch (error) {
      console.error(`Failed to get object content for key ${params.key}:`, error);
      throw error;
    }
  }

  private async _getAzureObjectContent(params: { key: string }): Promise<string> {
    try {
      const blobClient = this.containerClient.getBlobClient(params.key);
      const downloadResponse = await blobClient.download();
      const stream = downloadResponse.readableStreamBody as NodeJS.ReadableStream;
      const chunks: Buffer[] = [];
      for await (const chunk of stream) {
        chunks.push(Buffer.from(chunk));
      }
      return Buffer.concat(chunks).toString("utf-8");
    } catch (error) {
      console.error(`Failed to get Azure object content for key ${params.key}:`, error);
      throw error;
    }
  }
}
