import { Type } from "class-transformer";
import { Equals, IsDefined, IsNotEmpty, IsString, IsUUID, ValidateNested } from "class-validator";
import { accountDeletionMeta } from "../entities/account-deletion.meta";

export class AccountDeletionPostAttributesDTO {
  /** The target's email, or DELETE / ELIMINA when the target has no deliverable email. */
  @IsDefined()
  @IsString()
  @IsNotEmpty()
  confirmation: string;
}

export class AccountDeletionPostDataDTO {
  @Equals(accountDeletionMeta.endpoint)
  type: string;

  /** The target user id. */
  @IsUUID()
  id: string;

  @ValidateNested()
  @IsNotEmpty()
  @Type(() => AccountDeletionPostAttributesDTO)
  attributes: AccountDeletionPostAttributesDTO;
}

export class AccountDeletionPostDTO {
  @ValidateNested()
  @IsNotEmpty()
  @Type(() => AccountDeletionPostDataDTO)
  data: AccountDeletionPostDataDTO;
}
