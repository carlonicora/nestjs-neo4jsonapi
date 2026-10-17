import { Type } from "class-transformer";
import { Equals, IsNotEmpty, IsOptional, IsString, IsUUID, ValidateNested } from "class-validator";
import { userMeta } from "../../user/entities/user.meta";

export class UserPatchLanguageAttributesDTO {
  @IsOptional()
  @IsString()
  @IsNotEmpty()
  language?: string;
}

export class UserPatchLanguageDataDTO {
  @Equals(userMeta.endpoint)
  type: string;

  @IsUUID()
  id: string;

  @ValidateNested()
  @IsOptional()
  @Type(() => UserPatchLanguageAttributesDTO)
  attributes: UserPatchLanguageAttributesDTO;
}

export class UserPatchLanguageDTO {
  @ValidateNested()
  @IsNotEmpty()
  @Type(() => UserPatchLanguageDataDTO)
  data: UserPatchLanguageDataDTO;

  @IsOptional()
  included: any[];
}
