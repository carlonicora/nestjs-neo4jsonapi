import { Type } from "class-transformer";
import { Equals, IsDefined, IsNotEmpty, IsOptional, IsString, IsUUID, ValidateNested } from "class-validator";
import { blogPostMeta } from "../entities/blog-post.meta";
import { BlogCategoryDataListDTO } from "./blog-category.dto";

/**
 * Updates the shared fields and the ORIGINAL translation's text.
 * `status`, `publishedAt` and `author` are server-owned and never accepted.
 * `originalLanguage` is fixed after creation; the service ignores a different value.
 */
export class BlogPostPutAttributesDTO {
  @IsDefined()
  @IsNotEmpty()
  @IsString()
  originalLanguage: string;

  @IsDefined()
  @IsNotEmpty()
  @IsString()
  title: string;

  /** Slugified and uniquified by the service, then always kept. */
  @IsOptional()
  @IsString()
  slug?: string;

  /** BlockNote JSON, sent as a string. */
  @IsDefined()
  @IsNotEmpty()
  @IsString()
  body: string;

  @IsOptional()
  @IsString()
  summary?: string;

  @IsOptional()
  @IsString()
  coverImage?: string;

  @IsOptional()
  @IsString()
  coverImageAlt?: string;
}

export class BlogPostPutRelationshipsDTO {
  @ValidateNested()
  @IsOptional()
  @Type(() => BlogCategoryDataListDTO)
  categories?: BlogCategoryDataListDTO;
}

export class BlogPostPutDataDTO {
  @Equals(blogPostMeta.endpoint)
  type: string;

  @IsUUID()
  id: string;

  @ValidateNested()
  @IsNotEmpty()
  @Type(() => BlogPostPutAttributesDTO)
  attributes: BlogPostPutAttributesDTO;

  @ValidateNested()
  @IsOptional()
  @Type(() => BlogPostPutRelationshipsDTO)
  relationships?: BlogPostPutRelationshipsDTO;
}

export class BlogPostPutDTO {
  @ValidateNested()
  @IsNotEmpty()
  @Type(() => BlogPostPutDataDTO)
  data: BlogPostPutDataDTO;
}
