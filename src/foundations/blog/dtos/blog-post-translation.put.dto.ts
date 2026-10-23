import { Type } from "class-transformer";
import { Equals, IsDefined, IsNotEmpty, IsOptional, IsString, IsUUID, ValidateNested } from "class-validator";
import { blogPostTranslationMeta } from "../entities/blog-post-translation.meta";

/** Hand edit of one non-original translation; the service sets `source: "manual"`. */
export class BlogPostTranslationPutAttributesDTO {
  @IsDefined()
  @IsNotEmpty()
  @IsString()
  title: string;

  /** Slugified and uniquified by the service, then always kept. */
  @IsOptional()
  @IsString()
  slug?: string;

  @IsOptional()
  @IsString()
  summary?: string;

  /** BlockNote JSON, sent as a string. */
  @IsDefined()
  @IsNotEmpty()
  @IsString()
  body: string;

  @IsOptional()
  @IsString()
  coverImageAlt?: string;
}

export class BlogPostTranslationPutDataDTO {
  @Equals(blogPostTranslationMeta.endpoint)
  type: string;

  @IsUUID()
  id: string;

  @ValidateNested()
  @IsNotEmpty()
  @Type(() => BlogPostTranslationPutAttributesDTO)
  attributes: BlogPostTranslationPutAttributesDTO;
}

export class BlogPostTranslationPutDTO {
  @ValidateNested()
  @IsNotEmpty()
  @Type(() => BlogPostTranslationPutDataDTO)
  data: BlogPostTranslationPutDataDTO;
}
