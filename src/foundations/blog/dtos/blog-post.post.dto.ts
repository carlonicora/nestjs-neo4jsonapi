import { Type } from "class-transformer";
import { Equals, IsDefined, IsNotEmpty, IsOptional, IsString, IsUUID, ValidateNested } from "class-validator";
import { blogPostMeta } from "../entities/blog-post.meta";
import { BlogCategoryDataListDTO } from "./blog-category.dto";

/**
 * `status`, `publishedAt` and `author` are server-owned and never accepted.
 * `originalLanguage` is checked against the app's supported languages in the service.
 */
export class BlogPostPostAttributesDTO {
  @IsDefined()
  @IsNotEmpty()
  @IsString()
  originalLanguage: string;

  @IsDefined()
  @IsNotEmpty()
  @IsString()
  title: string;

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

export class BlogPostPostRelationshipsDTO {
  @ValidateNested()
  @IsOptional()
  @Type(() => BlogCategoryDataListDTO)
  categories?: BlogCategoryDataListDTO;
}

export class BlogPostPostDataDTO {
  @Equals(blogPostMeta.endpoint)
  type: string;

  @IsUUID()
  id: string;

  @ValidateNested()
  @IsNotEmpty()
  @Type(() => BlogPostPostAttributesDTO)
  attributes: BlogPostPostAttributesDTO;

  @ValidateNested()
  @IsOptional()
  @Type(() => BlogPostPostRelationshipsDTO)
  relationships?: BlogPostPostRelationshipsDTO;
}

export class BlogPostPostDTO {
  @ValidateNested()
  @IsNotEmpty()
  @Type(() => BlogPostPostDataDTO)
  data: BlogPostPostDataDTO;
}
