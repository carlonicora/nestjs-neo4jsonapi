import { Type } from "class-transformer";
import { Equals, IsDefined, IsNotEmpty, IsOptional, IsString, IsUUID, ValidateNested } from "class-validator";
import { UserDataDTO } from "@carlonicora/nestjs-neo4jsonapi";

import { howToMeta } from "src/features/essentials/how-to/entities/how-to.meta";

export class HowToPostAttributesDTO {
  @IsDefined()
  @IsNotEmpty()
  @IsString()
  name: string;

  @IsDefined()
  @IsNotEmpty()
  @IsString()
  description: string;

  @IsOptional()
  @IsString()
  pages?: string;

  @IsOptional()
  @IsString()
  abstract?: string;

  @IsOptional()
  @IsString()
  tldr?: string;

  @IsOptional()
  @IsString()
  aiStatus?: string;
}

export class HowToPostRelationshipsDTO {
  @ValidateNested()
  @IsDefined()
  @Type(() => UserDataDTO)
  author: UserDataDTO;
}

export class HowToPostDataDTO {
  @Equals(howToMeta.endpoint)
  type: string;

  @IsUUID()
  id: string;

  @ValidateNested()
  @IsNotEmpty()
  @Type(() => HowToPostAttributesDTO)
  attributes: HowToPostAttributesDTO;

  @ValidateNested()
  @IsNotEmpty()
  @Type(() => HowToPostRelationshipsDTO)
  relationships: HowToPostRelationshipsDTO;
}

export class HowToPostDTO {
  @ValidateNested()
  @IsNotEmpty()
  @Type(() => HowToPostDataDTO)
  data: HowToPostDataDTO;
}
