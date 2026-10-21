import { Type } from "class-transformer";
import { Equals, IsNotEmpty, IsUUID, ValidateNested } from "class-validator";
import { emailAutomationMeta } from "../entities/email-automation.meta";

export class EmailAutomationDTO {
  @Equals(emailAutomationMeta.endpoint)
  type: string;

  @IsUUID()
  id: string;
}

export class EmailAutomationDataDTO {
  @ValidateNested()
  @IsNotEmpty()
  @Type(() => EmailAutomationDTO)
  data: EmailAutomationDTO;
}
