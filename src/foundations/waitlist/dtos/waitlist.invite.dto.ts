import { Type } from "class-transformer";
import { IsArray, IsNotEmpty, IsString, ValidateNested } from "class-validator";

export class WaitlistInviteBatchAttributesDTO {
  @IsArray()
  @IsString({ each: true })
  ids: string[];
}

export class WaitlistInviteBatchDataDTO {
  type: string = "waitlist-batch-invites";

  @ValidateNested()
  @IsNotEmpty()
  @Type(() => WaitlistInviteBatchAttributesDTO)
  attributes: WaitlistInviteBatchAttributesDTO;
}

export class WaitlistInviteBatchDTO {
  @ValidateNested()
  @IsNotEmpty()
  @Type(() => WaitlistInviteBatchDataDTO)
  data: WaitlistInviteBatchDataDTO;
}
