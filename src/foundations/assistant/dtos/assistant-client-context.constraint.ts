import { ValidatorConstraint, ValidatorConstraintInterface } from "class-validator";
import { isAssistantClientContext } from "../../../common/interfaces/assistant.client-context.interface";

/**
 * Validates the `clientContext` attribute of a user message: a plain object of
 * at most 8 string values (see ASSISTANT_CLIENT_CONTEXT_LIMITS). A bad shape is
 * a 400 validation error from the global pipe.
 */
@ValidatorConstraint({ name: "assistantClientContext", async: false })
export class AssistantClientContextConstraint implements ValidatorConstraintInterface {
  validate(value: unknown): boolean {
    return isAssistantClientContext(value);
  }

  defaultMessage(): string {
    return "clientContext must be an object of at most 8 string values";
  }
}
