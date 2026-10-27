import { Type } from "class-transformer";
import { Equals, IsOptional, ValidateNested } from "class-validator";
import { EMAIL_BLAST_UNSUBSCRIBE_TYPE } from "../entities/email-blast.meta";

export class EmailBlastUnsubscribeDataDTO {
  @Equals(EMAIL_BLAST_UNSUBSCRIBE_TYPE)
  type: string;
}

// `data` is optional: the RFC 8058 one-click POST carries a form body
// (`List-Unsubscribe=One-Click`) that the global whitelist strips to `{}`,
// so `data` is absent on that path. The unsubscribe page sends `data`.
export class EmailBlastUnsubscribeDTO {
  @IsOptional()
  @ValidateNested()
  @Type(() => EmailBlastUnsubscribeDataDTO)
  data?: EmailBlastUnsubscribeDataDTO;
}
