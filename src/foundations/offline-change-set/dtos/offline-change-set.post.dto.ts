import { Type } from "class-transformer";
import {
  Equals,
  IsArray,
  IsDefined,
  IsIn,
  IsInt,
  IsNotEmpty,
  IsObject,
  IsOptional,
  IsString,
  IsUUID,
  Min,
  ValidateBy,
  ValidateNested,
  type ValidationOptions,
} from "class-validator";
import { offlineChangeSetMeta } from "../entities/offline-change-set.meta";

export const OFFLINE_CHANGE_METHODS = ["POST", "PUT", "PATCH", "DELETE"] as const;

export const OFFLINE_FIELD_CHOICES = ["mine", "theirs", "merged"] as const;

/** An object whose every value is one of `OFFLINE_FIELD_CHOICES`. */
function IsOfflineFieldChoices(options?: ValidationOptions): PropertyDecorator {
  return ValidateBy(
    {
      name: "isOfflineFieldChoices",
      validator: {
        validate: (value: unknown) =>
          !!value &&
          typeof value === "object" &&
          !Array.isArray(value) &&
          Object.values(value).every((choice) => (OFFLINE_FIELD_CHOICES as readonly unknown[]).includes(choice)),
        defaultMessage: () => `each choice must be one of ${OFFLINE_FIELD_CHOICES.join(", ")}`,
      },
    },
    options,
  );
}

export class OfflineChangeResolutionDTO {
  @IsDefined()
  @IsIn(["mine", "merged"])
  kind: "mine" | "merged";

  /** Per conflicting field: whose value wins. */
  @IsOptional()
  @IsOfflineFieldChoices()
  choices?: Record<string, (typeof OFFLINE_FIELD_CHOICES)[number]>;

  /** The model-built document holding only the fields chosen "merged". */
  @IsOptional()
  @IsObject()
  mergedBody?: Record<string, unknown>;
}

/** One queued change. */
export class OfflineChangeDTO {
  @IsDefined()
  @IsInt()
  @Min(0)
  seq: number;

  @IsDefined()
  @IsIn(OFFLINE_CHANGE_METHODS as unknown as string[])
  method: (typeof OFFLINE_CHANGE_METHODS)[number];

  @IsDefined()
  @IsNotEmpty()
  @IsString()
  path: string;

  @IsOptional()
  @IsObject()
  body?: Record<string, unknown>;

  @IsOptional()
  @IsString()
  recordType?: string;

  @IsOptional()
  @IsString()
  recordId?: string;

  @IsOptional()
  @IsObject()
  base?: Record<string, unknown> | null;

  @IsOptional()
  @ValidateNested()
  @Type(() => OfflineChangeResolutionDTO)
  resolution?: OfflineChangeResolutionDTO;
}

export class OfflineChangeSetPostAttributesDTO {
  @IsDefined()
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => OfflineChangeDTO)
  changes: OfflineChangeDTO[];
}

export class OfflineChangeSetPostDataDTO {
  @Equals(offlineChangeSetMeta.endpoint)
  type: string;

  @IsUUID()
  id: string;

  @ValidateNested()
  @IsNotEmpty()
  @Type(() => OfflineChangeSetPostAttributesDTO)
  attributes: OfflineChangeSetPostAttributesDTO;
}

/** `POST /offline-change-sets`: every change the device queued, in one package. */
export class OfflineChangeSetPostDTO {
  @ValidateNested()
  @IsNotEmpty()
  @Type(() => OfflineChangeSetPostDataDTO)
  data: OfflineChangeSetPostDataDTO;
}
