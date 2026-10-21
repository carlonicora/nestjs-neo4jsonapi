import { Type } from "class-transformer";
import { Equals, IsIn, IsNotEmpty, IsOptional, ValidateNested } from "class-validator";
import { EMAIL_AUTOMATION_UNSUBSCRIBE_TYPE } from "../entities/email-automation.meta";

export class EmailAutomationUnsubscribeAttributesDTO {
  @IsIn(["automation", "all"])
  scope: "automation" | "all";
}

export class EmailAutomationUnsubscribeDataDTO {
  @Equals(EMAIL_AUTOMATION_UNSUBSCRIBE_TYPE)
  type: string;

  @ValidateNested()
  @IsNotEmpty()
  @Type(() => EmailAutomationUnsubscribeAttributesDTO)
  attributes: EmailAutomationUnsubscribeAttributesDTO;
}

// `data` is optional: the RFC 8058 one-click POST carries a form body
// (`List-Unsubscribe=One-Click`) that the whitelist strips to `{}`.
export class EmailAutomationUnsubscribeDTO {
  @IsOptional()
  @ValidateNested()
  @Type(() => EmailAutomationUnsubscribeDataDTO)
  data?: EmailAutomationUnsubscribeDataDTO;
}
