import { Type } from "class-transformer";
import { Equals, IsDefined, IsNotEmpty, IsOptional, IsString, IsUUID, ValidateNested } from "class-validator";
import { blogCategoryMeta } from "../entities/blog-category.meta";

/** `originalLanguage` is checked against the app's supported languages in the service. */
export class BlogCategoryPostAttributesDTO {
  @IsDefined()
  @IsNotEmpty()
  @IsString()
  originalLanguage: string;

  @IsDefined()
  @IsNotEmpty()
  @IsString()
  name: string;

  @IsOptional()
  @IsString()
  description?: string;

  @IsOptional()
  @IsString()
  image?: string;
}

export class BlogCategoryPostDataDTO {
  @Equals(blogCategoryMeta.endpoint)
  type: string;

  @IsUUID()
  id: string;

  @ValidateNested()
  @IsNotEmpty()
  @Type(() => BlogCategoryPostAttributesDTO)
  attributes: BlogCategoryPostAttributesDTO;
}

export class BlogCategoryPostDTO {
  @ValidateNested()
  @IsNotEmpty()
  @Type(() => BlogCategoryPostDataDTO)
  data: BlogCategoryPostDataDTO;
}
