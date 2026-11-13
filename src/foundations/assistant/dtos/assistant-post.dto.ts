import { Type } from "class-transformer";
import {
  Equals,
  IsBoolean,
  IsDefined,
  IsNotEmpty,
  IsOptional,
  IsString,
  IsUUID,
  MaxLength,
  Validate,
  ValidateNested,
} from "class-validator";
import type { AssistantClientContext } from "../../../common/interfaces/assistant.client-context.interface";
import { AssistantClientContextConstraint } from "./assistant-client-context.constraint";
import { assistantMeta } from "../entities/assistant.meta";

/**
 * Reference to the resource a thread is bound to (the `content` relationship,
 * materialised as `(Assistant)-[:BOUND_TO]->(target)`).
 *
 * `type` is a plain `@IsString()` — NOT `@Equals(...)` — because the
 * relationship is polymorphic: any registered model may be the target. The
 * controller resolves the string against the model registry and rejects
 * unknown types there, which is the only place that knows the full set.
 */
export class AssistantContentReferenceDto {
  @IsString()
  @IsNotEmpty()
  type!: string;

  @IsUUID()
  id!: string;
}

export class AssistantContentRelationshipDto {
  @ValidateNested()
  @IsDefined()
  @Type(() => AssistantContentReferenceDto)
  data!: AssistantContentReferenceDto;
}

export class AssistantPostRelationshipsDto {
  @ValidateNested()
  @IsOptional()
  @Type(() => AssistantContentRelationshipDto)
  content?: AssistantContentRelationshipDto;
}

export class AssistantPostAttributesDto {
  /**
   * The first user message. Either plain text, or — following the host app's
   * BlockNote convention — a JSON-serialised BlockNote document. The server
   * detects the latter and derives the persisted markdown (and the pinned
   * entity mentions) from it; see AssistantService.resolveUserTurnInput.
   *
   * The cap is generous because a serialised document carries block structure
   * as well as prose.
   */
  @IsString()
  @IsNotEmpty()
  @MaxLength(200_000)
  content!: string;

  @IsString()
  @IsOptional()
  @MaxLength(200)
  title?: string;

  @IsOptional()
  @IsBoolean()
  howToMode?: boolean;

  @IsOptional()
  @IsString()
  limitToHowToId?: string;

  @IsOptional()
  @IsBoolean()
  handbookMode?: boolean;

  @IsOptional()
  @IsString()
  limitToHandbookPageId?: string;

  /**
   * Opaque context the client attaches to this user message (string values
   * only). Stored on the message and handed to the turn's seed providers and
   * operator tools.
   */
  @IsOptional()
  @Validate(AssistantClientContextConstraint)
  clientContext?: AssistantClientContext;
}

export class AssistantPostDataDto {
  @Equals(assistantMeta.endpoint)
  type!: string;

  @ValidateNested()
  @Type(() => AssistantPostAttributesDto)
  attributes!: AssistantPostAttributesDto;

  @ValidateNested()
  @IsOptional()
  @Type(() => AssistantPostRelationshipsDto)
  relationships?: AssistantPostRelationshipsDto;
}

export class AssistantPostDto {
  @ValidateNested()
  @Type(() => AssistantPostDataDto)
  data!: AssistantPostDataDto;
}
