import { BadRequestException } from "@nestjs/common";
import { modelRegistry } from "../registries/registry";

/**
 * Validate the polymorphic `content` relationship reference against the model
 * registry. The DTO can only assert that `type` is a non-empty string —
 * BOUND_TO accepts any registered model, and the registry is the only place
 * that knows the full set.
 *
 * Shared by `AssistantController` and `OperatorController`: both POST routes
 * take the same `AssistantPostDto` and must bind the created thread to the
 * scope the client sent, with identical validation and error text. It lives
 * here rather than as a private method on one controller so the two engines
 * cannot drift apart again (the operator route silently dropped the binding,
 * which created records outside the caller's scope).
 */
export function resolveBoundContent(reference?: {
  type: string;
  id: string;
}): { type: string; id: string } | undefined {
  if (!reference) return undefined;
  const model = modelRegistry.getByType(reference.type);
  if (!model) {
    throw new BadRequestException(`Unknown resource type "${reference.type}" for the assistant's bound content.`);
  }
  return { type: model.type, id: reference.id };
}
