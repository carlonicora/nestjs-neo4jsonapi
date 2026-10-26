import { Type } from "class-transformer";
import { Equals, IsDefined, IsNotEmpty, IsString, IsUUID, ValidateNested } from "class-validator";
import { accountDeletionMeta } from "../entities/account-deletion.meta";

export class AccountDeletionKeepPostAttributesDTO {
  /** The raw undo token from the request email. */
  @IsDefined()
  @IsString()
  @IsNotEmpty()
  token: string;
}

export class AccountDeletionKeepPostDataDTO {
  @Equals(accountDeletionMeta.endpoint)
  type: string;

  /** A client-generated v4 id; the server ignores its value. */
  @IsUUID()
  id: string;

  @ValidateNested()
  @IsNotEmpty()
  @Type(() => AccountDeletionKeepPostAttributesDTO)
  attributes: AccountDeletionKeepPostAttributesDTO;
}

export class AccountDeletionKeepPostDTO {
  @ValidateNested()
  @IsNotEmpty()
  @Type(() => AccountDeletionKeepPostDataDTO)
  data: AccountDeletionKeepPostDataDTO;
}
