import { DynamicStructuredTool } from "@langchain/core/tools";
import { TOOL_METADATA_KEY, ToolMetadata } from "../../../common";

/**
 * Type for tools object - keyed by method name.
 * Enables TypeScript autocomplete when picking individual tools.
 */
export type ToolsRecord = Record<string, DynamicStructuredTool>;

/**
 * Converts @Tool decorated methods to an OBJECT keyed by method name.
 * Enables picking individual tools: `this.lawTools.tools.findLawByName`
 *
 * The tools are bound to the instance, so they have access to all injected
 * dependencies via `this`.
 *
 * @param instance - The class instance with @Tool decorated methods
 * @returns Object of LangChain DynamicStructuredTool instances keyed by method name
 *
 * @example
 * ```typescript
 * @Injectable()
 * export class LawTools {
 *   constructor(private readonly lawRepository: LawRepository) {}
 *
 *   get tools(): ToolsRecord {
 *     return getToolsAsObject(this);
 *   }
 *
 *   @Tool({
 *     name: "find_law",
 *     description: "Find a law by name",
 *     schema: z.object({ name: z.string() }),
 *   })
 *   async findLaw({ name }: { name: string }) {
 *     return this.lawRepository.findByLawName({ name });
 *   }
 * }
 *
 * // Usage: pick individual tools
 * tools: [this.lawTools.tools.findLaw, this.otherTools.tools.search]
 * ```
 */
export function getToolsAsObject(instance: object): ToolsRecord {
  const toolsMetadata: Record<string, ToolMetadata> =
    Reflect.getMetadata(TOOL_METADATA_KEY, instance.constructor) || {};

  const result: ToolsRecord = {};

  for (const [methodName, metadata] of Object.entries(toolsMetadata)) {
    const method = (instance as Record<string, (...args: unknown[]) => unknown>)[methodName].bind(instance);

    result[methodName] = new DynamicStructuredTool({
      name: metadata.name,
      description: metadata.description,
      schema: metadata.schema,
      func: async (input: unknown) => {
        const value = await method(input);
        return typeof value === "string" ? value : JSON.stringify(value);
      },
    });
  }

  return result;
}

/**
 * Returns all @Tool decorated methods as an array of LangChain tools.
 * Convenience method when you want to pass all tools at once.
 *
 * @param instance - The class instance with @Tool decorated methods
 * @returns Array of LangChain DynamicStructuredTool instances
 *
 * @example
 * ```typescript
 * // Pass all tools from a provider
 * tools: this.lawTools.getTools()
 * ```
 */
export function getTools(instance: object): DynamicStructuredTool[] {
  return Object.values(getToolsAsObject(instance));
}
