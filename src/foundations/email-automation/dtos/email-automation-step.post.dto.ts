import { Type } from "class-transformer";
import {
  Equals,
  IsDefined,
  IsInt,
  IsNotEmpty,
  IsNumber,
  IsOptional,
  IsString,
  IsUUID,
  Min,
  ValidateNested,
} from "class-validator";
import { emailAutomationStepMeta } from "../entities/email-automation-step.meta";
import { EmailAutomationDataDTO } from "./email-automation.dto";

export class EmailAutomationStepPostAttributesDTO {
  @IsDefined()
  @IsNotEmpty()
  @IsString()
  subject: string;

  @IsDefined()
  @IsString()
  body: string;

  @IsOptional()
  @IsInt()
  @Min(0)
  delayHours?: number;

  @IsOptional()
  @IsNumber()
  positionX?: number;

  @IsOptional()
  @IsNumber()
  positionY?: number;
}

export class EmailAutomationStepPostRelationshipsDTO {
  @ValidateNested()
  @IsDefined()
  @Type(() => EmailAutomationDataDTO)
  automation: EmailAutomationDataDTO;
}

export class EmailAutomationStepPostDataDTO {
  @Equals(emailAutomationStepMeta.endpoint)
  type: string;

  @IsUUID()
  id: string;

  @ValidateNested()
  @IsNotEmpty()
  @Type(() => EmailAutomationStepPostAttributesDTO)
  attributes: EmailAutomationStepPostAttributesDTO;

  @ValidateNested()
  @IsNotEmpty()
  @Type(() => EmailAutomationStepPostRelationshipsDTO)
  relationships: EmailAutomationStepPostRelationshipsDTO;
}

export class EmailAutomationStepPostDTO {
  @ValidateNested()
  @IsNotEmpty()
  @Type(() => EmailAutomationStepPostDataDTO)
  data: EmailAutomationStepPostDataDTO;
}
