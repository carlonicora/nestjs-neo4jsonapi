import { Type } from "class-transformer";
import { Equals, IsDefined, IsNotEmpty, IsOptional, IsString, IsUUID, ValidateNested } from "class-validator";
import { blogCategoryTranslationMeta } from "../entities/blog-category-translation.meta";

/** Hand edit of one non-original translation; the service sets `source: "manual"`. */
export class BlogCategoryTranslationPutAttributesDTO {
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
}

export class BlogCategoryTranslationPutDataDTO {
  @Equals(blogCategoryTranslationMeta.endpoint)
  type: string;

  @IsUUID()
  id: string;

  @ValidateNested()
  @IsNotEmpty()
  @Type(() => BlogCategoryTranslationPutAttributesDTO)
  attributes: BlogCategoryTranslationPutAttributesDTO;
}

export class BlogCategoryTranslationPutDTO {
  @ValidateNested()
  @IsNotEmpty()
  @Type(() => BlogCategoryTranslationPutDataDTO)
  data: BlogCategoryTranslationPutDataDTO;
}
