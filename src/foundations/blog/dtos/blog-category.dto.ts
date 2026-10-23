import { Type } from "class-transformer";
import { Equals, IsNotEmpty, IsUUID, ValidateNested } from "class-validator";
import { blogCategoryMeta } from "../entities/blog-category.meta";

export class BlogCategoryDTO {
  @Equals(blogCategoryMeta.endpoint)
  type: string;

  @IsUUID()
  id: string;
}

export class BlogCategoryDataDTO {
  @ValidateNested()
  @IsNotEmpty()
  @Type(() => BlogCategoryDTO)
  data: BlogCategoryDTO;
}

export class BlogCategoryDataListDTO {
  @ValidateNested({ each: true })
  @IsNotEmpty()
  @Type(() => BlogCategoryDTO)
  data: BlogCategoryDTO[];
}
