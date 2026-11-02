import { Type } from "class-transformer";
import { Equals, IsDefined, IsIn, IsNotEmpty, IsString, IsUUID, ValidateNested } from "class-validator";
import { emailAutomationEnrollmentMeta } from "../entities/email-automation-enrollment.meta";

export class EmailAutomationEnrollmentPostAttributesDTO {
  @IsDefined()
  @IsIn(["user", "waitlist"])
  recipientType: "user" | "waitlist";

  @IsDefined()
  @IsNotEmpty()
  @IsString()
  recipientId: string;
}

export class EmailAutomationEnrollmentPostDataDTO {
  @Equals(emailAutomationEnrollmentMeta.endpoint)
  type: string;

  @IsUUID()
  id: string;

  @ValidateNested()
  @IsNotEmpty()
  @Type(() => EmailAutomationEnrollmentPostAttributesDTO)
  attributes: EmailAutomationEnrollmentPostAttributesDTO;
}

export class EmailAutomationEnrollmentPostDTO {
  @ValidateNested()
  @IsNotEmpty()
  @Type(() => EmailAutomationEnrollmentPostDataDTO)
  data: EmailAutomationEnrollmentPostDataDTO;
}
