import { ZodType } from "zod";

export const TOOL_METADATA_KEY = "llm:tool";

export interface ToolMetadata {
  name: string;
  description: string;
  schema: ZodType;
  methodName?: string;
}

/**
 * Decorator that marks a method as a LangChain tool.
 * The method will have access to all injected dependencies via `this`.
 *
 * Tools are stored as an OBJECT keyed by method name, enabling individual access:
 * `this.lawTools.tools.findLawByName`
 *
 * @example
 * ```typescript
 * @Tool({
 *   name: "find_law_by_name",
 *   description: "Search for an Italian law by name",
 *   schema: z.object({ name: z.string() }),
 * })
 * async findLawByName({ name }: { name: string }) {
 *   return await this.lawRepository.findByLawName({ name });
 * }
 * ```
 */
export function Tool(metadata: ToolMetadata): MethodDecorator {
  return (target, propertyKey, descriptor) => {
    // Get existing tools object or create new one
    const existingTools: Record<string, ToolMetadata> =
      Reflect.getMetadata(TOOL_METADATA_KEY, target.constructor) || {};

    // Store metadata keyed by method name
    existingTools[String(propertyKey)] = {
      ...metadata,
      methodName: String(propertyKey),
    };

    Reflect.defineMetadata(TOOL_METADATA_KEY, existingTools, target.constructor);
    return descriptor;
  };
}
