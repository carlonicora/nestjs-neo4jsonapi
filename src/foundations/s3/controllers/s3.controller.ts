import {
  BadRequestException,
  Controller,
  Delete,
  ForbiddenException,
  Get,
  HttpCode,
  HttpStatus,
  Inject,
  Optional,
  Query,
  UseGuards,
} from "@nestjs/common";
import { ClsService } from "nestjs-cls";

import { JwtAuthGuard } from "../../../common/guards/jwt.auth.guard";
import {
  isWellFormedS3Key,
  S3_KEY_ACCESS_POLICY,
  S3KeyAccessPolicy,
  S3KeyAction,
} from "../../../common/interfaces/s3.key-access.policy.interface";
import { s3Meta } from "../../s3/entities/s3.meta";
import { S3Service } from "../../s3/services/s3.service";

@Controller(s3Meta.endpoint)
export class S3Controller {
  constructor(
    private readonly service: S3Service,
    private readonly clsService: ClsService,
    @Optional()
    @Inject(S3_KEY_ACCESS_POLICY)
    private readonly keyPolicy?: S3KeyAccessPolicy,
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
}
