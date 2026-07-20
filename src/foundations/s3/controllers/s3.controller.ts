import { Controller, Delete, Get, HttpCode, HttpStatus, Query, UseGuards } from "@nestjs/common";

import { JwtAuthGuard } from "../../../common/guards/jwt.auth.guard";
import { s3Meta } from "../../s3/entities/s3.meta";
import { S3Service } from "../../s3/services/s3.service";

@Controller(s3Meta.endpoint)
export class S3Controller {
  constructor(private readonly service: S3Service) {}

  @UseGuards(JwtAuthGuard)
  @Get()
  async getPresignedUrl(
    @Query("key") key: string,
    @Query("contentType") contentType: string,
    @Query("isPublic") isPublic: boolean,
  ) {
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
    await this.service.deleteFileFromS3({ key: key });
  }
}
