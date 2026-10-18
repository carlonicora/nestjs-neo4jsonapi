import {
  BadRequestException,
  Controller,
  Delete,
  ForbiddenException,
  Get,
  HttpCode,
  HttpStatus,
  Inject,
  InternalServerErrorException,
  Optional,
  Param,
  PayloadTooLargeException,
  Put,
  Query,
  Req,
  Res,
  UnauthorizedException,
  UseGuards,
} from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { FastifyReply, FastifyRequest } from "fastify";
import { ClsService } from "nestjs-cls";
import { Readable, Transform } from "stream";

import { JwtAuthGuard } from "../../../common/guards/jwt.auth.guard";
import {
  isWellFormedS3Key,
  S3_KEY_ACCESS_POLICY,
  S3KeyAccessPolicy,
  S3KeyAction,
} from "../../../common/interfaces/s3.key-access.policy.interface";
import { BaseConfigInterface } from "../../../config/interfaces/base.config.interface";
import {
  TRUSTED_ORIGINS_RESOLVER,
  TrustedOriginsResolver,
} from "../../../core/cors/interfaces/trusted-origins.resolver.interface";
import { ConfigAppInterface } from "../../../config/interfaces/config.app.interface";
import {
  S3CipherKeyMissingError,
  S3ObjectTokenError,
  S3ObjectTokenOp,
  S3ObjectTokenPayload,
} from "../../s3/cipher/s3-cipher.core";
import { S3_OBJECTS_SEGMENT, s3Meta } from "../../s3/entities/s3.meta";
import { S3CipherService } from "../../s3/services/s3-cipher.service";
import { S3Service } from "../../s3/services/s3.service";

/** How long the browser keeps a file reached through a permanent (non-expiring) link. */
const PERMANENT_LINK_CACHE_SECONDS = 3600;

@Controller(s3Meta.endpoint)
export class S3Controller {
  constructor(
    private readonly service: S3Service,
    private readonly clsService: ClsService,
    private readonly cipher: S3CipherService,
    private readonly configService: ConfigService<BaseConfigInterface>,
    @Optional()
    @Inject(S3_KEY_ACCESS_POLICY)
    private readonly keyPolicy?: S3KeyAccessPolicy,
    // Optional application-provided extra origins (e.g. per-tenant custom domains) that may
    // also frame a downloaded object. Absent = only the app origin, as before.
    @Optional()
    @Inject(TRUSTED_ORIGINS_RESOLVER)
    private readonly trustedOrigins?: TrustedOriginsResolver,
  ) {}

  @UseGuards(JwtAuthGuard)
  @Get()
  async getPresignedUrl(
    @Query("key") key: string,
    @Query("contentType") contentType: string,
    @Query("isPublic") isPublic: boolean,
  ) {
    await this.assertKeyAccess({ key, action: "upload", isPublic });

    return await this.service.generatePresignedUrl({
      key: key,
      contentType: contentType,
      isPublic: isPublic,
    });
  }

  @UseGuards(JwtAuthGuard)
  @Get(`sign`)
  async getSignedUrl(
    @Query("key") key: string,
    @Query("isPublic") isPublic: boolean,
    @Query("filename") filename?: string,
  ) {
    await this.assertKeyAccess({ key, action: "download", isPublic });

    return await this.service.findSignedUrl({
      key: key,
      isPublic: isPublic,
      filename: filename,
    });
  }

  @UseGuards(JwtAuthGuard)
  @Delete()
  @HttpCode(HttpStatus.NO_CONTENT)
  async deleteFile(@Query("key") key: string) {
    await this.assertKeyAccess({ key, action: "delete", isPublic: false });

    await this.service.deleteFileFromS3({ key: key });
  }

  /**
   * Rejects a malformed key (400) whether or not a policy is bound, then asks
   * the bound policy, if any, and rejects a refusal (403).
   */
  private async assertKeyAccess(params: {
    key: unknown;
    action: S3KeyAction;
    isPublic: boolean | string | undefined;
  }): Promise<void> {
    if (!isWellFormedS3Key(params.key)) throw new BadRequestException("Invalid S3 key");

    if (!this.keyPolicy) return;

    const allowed = await this.keyPolicy.canAccess({
      key: params.key,
      action: params.action,
      // Query params arrive as strings: "true" is the only truthy value the clients send.
      isPublic: params.isPublic === true || params.isPublic === "true",
      userId: this.clsService.get("userId"),
      companyId: this.clsService.get("companyId"),
      roles: this.clsService.get("roles") ?? [],
    });

    if (!allowed) throw new ForbiddenException("You cannot access this file.");
  }

  /**
   * Token-authorised upload. The raw body arrives as a stream (see setupS3ObjectUploadStreaming);
   * it is counted against the upload cap and streamed to storage, where S3Service encrypts it.
   */
  @Put(`${S3_OBJECTS_SEGMENT}/:token`)
  async putObject(
    @Req() req: FastifyRequest,
    @Res() reply: FastifyReply,
    @Param("token") token: string,
  ): Promise<void> {
    const payload = this._verifyToken(token, "put");

    const maxBytes = Math.min(this.cipher.uploadMaxBytes, payload.m ?? Infinity);
    let received = 0;
    let tooLarge = false;
    const counter = new Transform({
      transform(chunk: Buffer, _encoding, callback) {
        received += chunk.length;
        if (received > maxBytes) {
          tooLarge = true;
          callback(new PayloadTooLargeException(`Upload exceeds ${maxBytes} bytes`));
          return;
        }
        callback(null, chunk);
      },
    });

    const body = req.body as Readable;
    body.on("error", (error) => counter.destroy(error));
    counter.on("error", () => {
      body.unpipe(counter);
      body.resume();
    });
    body.pipe(counter);

    try {
      await this.service.uploadStream({
        key: payload.k,
        contentType: payload.c ?? "application/octet-stream",
        stream: counter,
      });
    } catch (error) {
      if (tooLarge) throw new PayloadTooLargeException(`Upload exceeds ${maxBytes} bytes`);
      throw error;
    }

    reply.status(204).send();
  }

  /**
   * Token-authorised download. Streams the (decrypted) object; never serves ciphertext.
   */
  @Get(`${S3_OBJECTS_SEGMENT}/:token`)
  async getObject(@Res() reply: FastifyReply, @Param("token") token: string): Promise<void> {
    const payload = this._verifyToken(token, "get");

    let object: Awaited<ReturnType<S3Service["downloadObject"]>>;
    try {
      object = await this.service.downloadObject({ key: payload.k });
    } catch (error) {
      if (error instanceof S3CipherKeyMissingError) throw new InternalServerErrorException(error.message);
      throw error;
    }
    if (!object) {
      reply.status(404).send({ errors: [{ status: "404", title: "Not Found" }] });
      return;
    }

    reply.header("Content-Type", object.contentType ?? "application/octet-stream");
    reply.header(
      "Content-Disposition",
      payload.f && payload.i
        ? this.service.contentDispositionInlineFilename(payload.f)
        : payload.f
          ? this.service.contentDispositionAttachment(payload.f)
          : this.service.contentDispositionInline(payload.k),
    );
    reply.header("Cache-Control", this._cacheControl(payload));
    reply.header("Accept-Ranges", "none");

    // The web app embeds downloaded PDFs in an iframe, but a host that registers helmet (the corpus)
    // denies framing by default. Let the app origin, plus any origin the application trusts, frame it.
    const frameAncestors = await this._frameAncestors();
    if (frameAncestors) {
      reply.header("Content-Security-Policy", `frame-ancestors ${frameAncestors}`);
      reply.removeHeader("X-Frame-Options");
    }

    reply.send(object.stream);
  }

  /**
   * The browser may keep the file for as long as the link stays valid: the same link always
   * names the same key, and an expiring link is re-minted with a new URL once it lapses.
   * A permanent link (no expiry) is kept for one hour only: its key can be overwritten in place
   * (the how-to seed rewrites `howtos/<slug>/<file>`), so a replaced file shows at most an hour late.
   */
  private _cacheControl(payload: S3ObjectTokenPayload): string {
    if (payload.e === undefined) return `private, max-age=${PERMANENT_LINK_CACHE_SECONDS}`;
    const remaining = Math.max(0, payload.e - Math.floor(Date.now() / 1000));
    return `private, max-age=${remaining}`;
  }

  /**
   * The space-separated `frame-ancestors` source list: the app origin, then every origin the bound
   * TRUSTED_ORIGINS_RESOLVER lists, deduplicated. Undefined when the list is empty. A failing
   * resolver falls back to the app origin alone.
   */
  private async _frameAncestors(): Promise<string | undefined> {
    const origins: string[] = [];
    const appOrigin = this._appOrigin();
    if (appOrigin) origins.push(appOrigin);

    if (this.trustedOrigins) {
      try {
        origins.push(...(await this.trustedOrigins.listOrigins()));
      } catch (error) {
        console.error("S3: Trusted-origins resolver failed; framing limited to the app origin", error);
      }
    }

    const unique = [...new Set(origins.filter((origin) => typeof origin === "string" && origin.length > 0))];
    return unique.length > 0 ? unique.join(" ") : undefined;
  }

  private _appOrigin(): string | undefined {
    const url = this.configService.get<ConfigAppInterface>("app")?.url;
    if (!url) return undefined;

    try {
      const origin = new URL(url).origin;
      return origin === "null" ? undefined : origin;
    } catch {
      return undefined;
    }
  }

  private _verifyToken(token: string, op: S3ObjectTokenOp): S3ObjectTokenPayload {
    let payload: S3ObjectTokenPayload;
    try {
      payload = this.cipher.verifyObjectToken(token, op);
    } catch (error) {
      if (error instanceof S3ObjectTokenError) throw new UnauthorizedException(error.message);
      throw error;
    }
    // Only the server signs tokens, but a signed key must still be one the logged-in routes accept.
    if (!isWellFormedS3Key(payload.k)) throw new BadRequestException("Invalid S3 key");
    // A key the bound policy does not serve here is refused before any storage read or write.
    if (this.keyPolicy?.isServableKey && !this.keyPolicy.isServableKey(payload.k))
      throw new ForbiddenException("This object is not served here");
    // A permanent (non-expiring) download link is honoured only for keys the bound policy allows to
    // be permanent: this stops already-issued permanent links to sensitive files.
    if (
      op === "get" &&
      payload.e === undefined &&
      this.keyPolicy?.isPermanentKey &&
      !this.keyPolicy.isPermanentKey(payload.k)
    )
      throw new UnauthorizedException("Permanent object token not allowed for this key");
    return payload;
  }
}
