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
import { handbookThreadMeta } from "../entities/handbook-thread.meta";

/**
 * Body of `POST /handbookthreads`.
 *
 * The thread is created FROM the first question, so the payload carries
 * `question` and not `title`: the title is derived server-side from the
 * answer the responder produces. No `id` — the server mints it.
 */
export class HandbookThreadPostAttributesDTO {
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

export class HandbookThreadPostDataDTO {
  @Equals(handbookThreadMeta.endpoint)
  type: string;

  @ValidateNested()
  @IsNotEmpty()
  @Type(() => HandbookThreadPostAttributesDTO)
  attributes: HandbookThreadPostAttributesDTO;
}

export class HandbookThreadPostDTO {
  @ValidateNested()
  @IsNotEmpty()
  @Type(() => HandbookThreadPostDataDTO)
  data: HandbookThreadPostDataDTO;
}
