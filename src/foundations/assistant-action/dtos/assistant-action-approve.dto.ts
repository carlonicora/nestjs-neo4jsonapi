import { Type } from "class-transformer";
import {
  Equals,
  IsNotEmpty,
  IsOptional,
  IsUUID,
  Validate,
  ValidateNested,
  ValidatorConstraint,
  ValidatorConstraintInterface,
} from "class-validator";
import { assistantActionMeta } from "../entities/assistant-action.meta";

/**
 * `edits` is a plain object of string values (field name → new value). Which
 * keys are allowed depends on the stored action, so that check lives in
 * `AssistantService.resolveAction`.
 */
@ValidatorConstraint({ name: "assistantActionEdits", async: false })
export class AssistantActionEditsConstraint implements ValidatorConstraintInterface {
  validate(value: unknown): boolean {
    if (!value || typeof value !== "object" || Array.isArray(value)) return false;
    return Object.values(value as Record<string, unknown>).every((entry) => typeof entry === "string");
  }

  defaultMessage(): string {
    return "edits must be an object of string values";
  }
}

export class AssistantActionApproveAttributesDto {
  @IsOptional()
  @Validate(AssistantActionEditsConstraint)
  edits?: Record<string, string>;
}

export class AssistantActionApproveDataDto {
  @Equals(assistantActionMeta.endpoint)
  type!: string;

  @IsUUID()
  id!: string;

  @IsOptional()
  @ValidateNested()
  @Type(() => AssistantActionApproveAttributesDto)
  attributes?: AssistantActionApproveAttributesDto;
}

/**
 * Optional body of `POST /assistant-actions/:actionId/approve`. No body, no
 * `edits` or `{}` approves the action exactly as proposed.
 */
export class AssistantActionApproveDto {
  @IsOptional()
  @ValidateNested()
  @IsNotEmpty()
  @Type(() => AssistantActionApproveDataDto)
  data?: AssistantActionApproveDataDto;
}
