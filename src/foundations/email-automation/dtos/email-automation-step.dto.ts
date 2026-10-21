import { Type } from "class-transformer";
import { Equals, IsNotEmpty, IsUUID, ValidateNested } from "class-validator";
import { emailAutomationStepMeta } from "../entities/email-automation-step.meta";

export class EmailAutomationStepDTO {
  @Equals(emailAutomationStepMeta.endpoint)
  type: string;

  @IsUUID()
  id: string;
}

export class EmailAutomationStepDataDTO {
  @ValidateNested()
  @IsNotEmpty()
  @Type(() => EmailAutomationStepDTO)
  data: EmailAutomationStepDTO;
}
