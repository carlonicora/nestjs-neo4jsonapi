import { Type } from "class-transformer";
import {
  Equals,
  IsDefined,
  IsNotEmpty,
  IsOptional,
  IsString,
  IsUUID,
  MaxLength,
  ValidateNested,
} from "class-validator";
import { handbookThreadMessageMeta } from "../entities/handbook-thread-message.meta";

/**
 * Body of `POST /handbookthreads/:handbookThreadId/handbookthreadmessages`.
 *
 * The thread is named by the URL, so the payload carries only the question.
 * `type` is checked against the MESSAGE meta — the resource being appended —
 * not the thread's.
 */
export class HandbookThreadMessagePostAttributesDTO {
  @IsDefined()
  @IsNotEmpty()
  @IsString()
  @MaxLength(10_000)
  question: string;

  /**
   * Scopes the turn to a single handbook page. Optional and off by default: a
   * question asked while reading one page usually needs the whole manual, and
   * defaulting to restriction would silently hide the rest of it.
   */
  @IsOptional()
  @IsUUID()
  handbookPageId?: string;
}

export class HandbookThreadMessagePostDataDTO {
  @Equals(handbookThreadMessageMeta.endpoint)
  type: string;

  @ValidateNested()
  @IsNotEmpty()
  @Type(() => HandbookThreadMessagePostAttributesDTO)
  attributes: HandbookThreadMessagePostAttributesDTO;
}

export class HandbookThreadMessagePostDTO {
  @ValidateNested()
  @IsNotEmpty()
  @Type(() => HandbookThreadMessagePostDataDTO)
  data: HandbookThreadMessagePostDataDTO;
}
