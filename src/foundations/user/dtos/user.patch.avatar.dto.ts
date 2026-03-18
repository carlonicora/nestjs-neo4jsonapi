import { Type } from "class-transformer";
import { Equals, IsDefined, IsNotEmpty, IsOptional, IsString, IsUUID, ValidateNested } from "class-validator";
import { userMeta } from "../../user/entities/user.meta";

export class UserPatchAvatarAttributesDTO {
  @IsDefined()
  @IsString()
  avatar: string;
}

export class UserPatchAvatarDataDTO {
  @Equals(userMeta.endpoint)
  type: string;

  @IsUUID()
  id: string;

  @ValidateNested({ each: true })
  @IsOptional()
  @Type(() => UserPatchAvatarAttributesDTO)
  attributes: UserPatchAvatarAttributesDTO;
}

export class UserPatchAvatarDTO {
  @ValidateNested()
  @IsNotEmpty()
  @Type(() => UserPatchAvatarDataDTO)
  data: UserPatchAvatarDataDTO;

  @IsOptional()
  included: any[];
}
