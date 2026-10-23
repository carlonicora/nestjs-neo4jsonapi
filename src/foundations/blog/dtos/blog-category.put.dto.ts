import { Type } from "class-transformer";
import { Equals, IsDefined, IsNotEmpty, IsOptional, IsString, IsUUID, ValidateNested } from "class-validator";
import { blogCategoryMeta } from "../entities/blog-category.meta";

/**
 * Updates the shared fields and the ORIGINAL translation's text.
 * `originalLanguage` is fixed after creation; the service ignores a different value.
 */
export class BlogCategoryPutAttributesDTO {
  @IsDefined()
  @IsNotEmpty()
  @IsString()
  originalLanguage: string;

  @IsDefined()
  @IsNotEmpty()
  @IsString()
  name: string;

  /** Slugified and uniquified by the service, then always kept. */
  @IsOptional()
  @IsString()
  slug?: string;

  @IsOptional()
  @IsString()
  description?: string;

  @IsOptional()
  @IsString()
  image?: string;
}

export class BlogCategoryPutDataDTO {
  @Equals(blogCategoryMeta.endpoint)
  type: string;

  @IsUUID()
  id: string;

  @ValidateNested()
  @IsNotEmpty()
  @Type(() => BlogCategoryPutAttributesDTO)
  attributes: BlogCategoryPutAttributesDTO;
}

export class BlogCategoryPutDTO {
  @ValidateNested()
  @IsNotEmpty()
  @Type(() => BlogCategoryPutDataDTO)
  data: BlogCategoryPutDataDTO;
}
