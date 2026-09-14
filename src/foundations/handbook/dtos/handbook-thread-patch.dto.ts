import { Type } from "class-transformer";
import { Equals, IsDefined, IsNotEmpty, IsString, IsUUID, MaxLength, ValidateNested } from "class-validator";
import { handbookThreadMeta } from "../entities/handbook-thread.meta";

/**
 * Body of `PATCH /handbookthreads/:handbookThreadId` — the rename.
 *
 * `title` is the only mutable attribute a client may send. The thread's
 * messages and its owner edge are server-managed; `owner` is declared
 * `immutable` on the descriptor so it cannot be re-pointed here either.
 */
export class HandbookThreadPatchAttributesDTO {
  @IsDefined()
  @IsNotEmpty()
  @IsString()
  @MaxLength(200)
  title: string;
}

export class HandbookThreadPatchDataDTO {
  @Equals(handbookThreadMeta.endpoint)
  type: string;

  @IsUUID()
  id: string;

  @ValidateNested()
  @IsNotEmpty()
  @Type(() => HandbookThreadPatchAttributesDTO)
  attributes: HandbookThreadPatchAttributesDTO;
}

export class HandbookThreadPatchDTO {
  @ValidateNested()
  @IsNotEmpty()
  @Type(() => HandbookThreadPatchDataDTO)
  data: HandbookThreadPatchDataDTO;
}
