import { Type } from "class-transformer";
import { Equals, IsDefined, IsString, MaxLength, ValidateNested } from "class-validator";
import { referralVisitMeta } from "../entities/referral-visit.meta";

export class ReferralVisitPostAttributesDTO {
  // No UUID check: a malformed code still answers 204; the service finds no
  // company for it and writes nothing.
  @IsDefined()
  @IsString()
  @MaxLength(100)
  referralCode: string;
}

// No `id`: the server generates the visit id, the client never names a node.
export class ReferralVisitPostDataDTO {
  @Equals(referralVisitMeta.endpoint)
  type: string;

  @IsDefined()
  @ValidateNested()
  @Type(() => ReferralVisitPostAttributesDTO)
  attributes: ReferralVisitPostAttributesDTO;
}

export class ReferralVisitPostDTO {
  @IsDefined()
  @ValidateNested()
  @Type(() => ReferralVisitPostDataDTO)
  data: ReferralVisitPostDataDTO;
}
