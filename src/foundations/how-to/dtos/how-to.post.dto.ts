import { Type } from "class-transformer";
import { Equals, IsDefined, IsNotEmpty, IsOptional, IsString, IsUUID, ValidateNested } from "class-validator";
import { howToMeta } from "../entities/how-to.meta";

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
}

export class HowToPostDTO {
  @ValidateNested()
  @IsNotEmpty()
  @Type(() => HowToPostDataDTO)
  data: HowToPostDataDTO;
}
