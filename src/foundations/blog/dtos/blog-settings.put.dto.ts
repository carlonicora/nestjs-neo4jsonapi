import { Type } from "class-transformer";
import { Equals, IsDefined, IsIn, IsNotEmpty, IsUUID, ValidateNested } from "class-validator";
import { BLOG_LIST_LAYOUTS, BlogListLayout } from "../blog.constants";
import { blogSettingsMeta } from "../entities/blog-settings.meta";

export class BlogSettingsPutAttributesDTO {
  @IsDefined()
  @IsIn(BLOG_LIST_LAYOUTS)
  listLayout: BlogListLayout;
}

/** The id must be `BLOG_SETTINGS_ID`; the service rejects any other id with 400. */
export class BlogSettingsPutDataDTO {
  @Equals(blogSettingsMeta.endpoint)
  type: string;

  @IsUUID()
  id: string;

  @ValidateNested()
  @IsNotEmpty()
  @Type(() => BlogSettingsPutAttributesDTO)
  attributes: BlogSettingsPutAttributesDTO;
}

export class BlogSettingsPutDTO {
  @ValidateNested()
  @IsNotEmpty()
  @Type(() => BlogSettingsPutDataDTO)
  data: BlogSettingsPutDataDTO;
}
