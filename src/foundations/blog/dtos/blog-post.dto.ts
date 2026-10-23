import { Type } from "class-transformer";
import { Equals, IsNotEmpty, IsUUID, ValidateNested } from "class-validator";
import { blogPostMeta } from "../entities/blog-post.meta";

export class BlogPostDTO {
  @Equals(blogPostMeta.endpoint)
  type: string;

  @IsUUID()
  id: string;
}

export class BlogPostDataDTO {
  @ValidateNested()
  @IsNotEmpty()
  @Type(() => BlogPostDTO)
  data: BlogPostDTO;
}

export class BlogPostDataListDTO {
  @ValidateNested({ each: true })
  @IsNotEmpty()
  @Type(() => BlogPostDTO)
  data: BlogPostDTO[];
}
