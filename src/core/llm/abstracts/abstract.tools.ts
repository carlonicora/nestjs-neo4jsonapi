import { DynamicStructuredTool } from "@langchain/core/tools";
import { getTools, getToolsAsObject, ToolsRecord } from "../utils/tools.utils";

/**
 * Abstract base class for Tools providers.
 * Centralizes the `tools` getter and `getTools()` method.
 *
 * @typeParam TRecord - Typed interface for autocomplete support (keys = method names)
 *
 * @example
 * ```typescript
 * // 1. Define typed interface for autocomplete
 * interface MyToolsRecord {
 *   searchDocuments: DynamicStructuredTool;
 *   analyzeText: DynamicStructuredTool;
 * }
 *
 * // 2. Extend AbstractTools with your interface
 * @Injectable()
 * export class MyTools extends AbstractTools<MyToolsRecord> {
 *   constructor(private readonly myService: MyService) {
 *     super();
 *   }
 *
 *   @Tool({
 *     name: "search_documents",
 *     description: "Search for documents",
 *     schema: z.object({ query: z.string() }),
 *   })
 *   async searchDocuments({ query }: { query: string }) {
 *     return this.myService.search(query);
 *   }
 *
 *   @Tool({
 *     name: "analyze_text",
 *     description: "Analyze text content",
 *     schema: z.object({ text: z.string() }),
 *   })
 *   async analyzeText({ text }: { text: string }) {
 *     return this.myService.analyze(text);
 *   }
 * }
 *
 * // 3. Usage - pick individual tools with autocomplete
 * tools: [this.myTools.tools.searchDocuments, this.lawTools.tools.findLawsByName]
 *
 * // Or pass all tools from one provider
 * tools: this.myTools.getTools()
 * ```
 */
export abstract class AbstractTools<TRecord = ToolsRecord> {
  /**
   * Object of tools keyed by method name - for picking individual tools.
   * Provides autocomplete when TRecord is properly typed.
   */
  get tools(): TRecord {
    return getToolsAsObject(this) as unknown as TRecord;
  }

  /**
   * Returns all @Tool decorated methods as an array.
   * Use when you want to pass all tools from this provider at once.
   */
  getTools(): DynamicStructuredTool[] {
    return getTools(this);
  }
}
