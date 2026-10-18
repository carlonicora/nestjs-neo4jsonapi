import { Type } from "class-transformer";
import {
  Equals,
  IsBoolean,
  IsDefined,
  IsEmail,
  IsNotEmpty,
  IsOptional,
  IsString,
  IsUUID,
  ValidateNested,
} from "class-validator";
import { CompanyDataDTO } from "../../company/dtos/company.dto";
import { RoleDataListDTO } from "../../role/dtos/role.dto";

import { CompanyPostDataDTO } from "../../company/dtos/company.post.dto";
import { userMeta } from "../../user/entities/user.meta";

export class UserPostAttributesDTO {
  @IsDefined()
  @IsEmail()
  email: string;

  @IsOptional()
  @IsDefined()
  name?: string;

  @IsOptional()
  @IsString()
  password?: string;

  @IsOptional()
  @IsBoolean()
  sendInvitationEmail?: boolean;

  @IsOptional()
  @IsBoolean()
  adminCreated?: boolean;

  @IsOptional()
  @IsString()
  avatar?: string;

  @IsOptional()
  @IsString()
  title?: string;

  @IsOptional()
  @IsString()
  bio?: string;

  @IsOptional()
  @IsString()
  phone?: string;
}

export class UserPostRelationshipsDTO {
  @ValidateNested({ each: true })
  @IsOptional()
  @Type(() => RoleDataListDTO)
  roles?: RoleDataListDTO;

  @ValidateNested({ each: true })
  @IsDefined()
  @Type(() => CompanyDataDTO)
  company: CompanyDataDTO;
}

export class UserPostDataDTO {
  @Equals(userMeta.endpoint)
  type: string;

  @IsUUID()
  id: string;

  @ValidateNested()
  @IsNotEmpty()
  @Type(() => UserPostAttributesDTO)
  attributes: UserPostAttributesDTO;

  @ValidateNested()
  @IsOptional()
  @Type(() => UserPostRelationshipsDTO)
  relationships?: UserPostRelationshipsDTO;
}

export class UserPostDTO {
  @ValidateNested()
  @IsNotEmpty()
  @Type(() => UserPostDataDTO)
  data: UserPostDataDTO;

  @IsOptional()
  included?: CompanyPostDataDTO[];
}
