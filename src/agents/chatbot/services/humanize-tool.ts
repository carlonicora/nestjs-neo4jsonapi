/**
 * Humanise a tool invocation into a user-facing status string.
 * Used by ChatbotService to emit `assistant:status` socket events before each
 * tool call (see Task 17). Falls back to `Running <toolName>` for tools we
 * haven't explicitly labelled — the UI still gets a progress hint, and the
 * assistant turn continues regardless.
 */
export function humanizeTool(tool: string, input: Record<string, unknown>): string {
  const type = typeof input.type === "string" ? input.type : "";
  switch (tool) {
    case "describe_entity":
      return `Looking up ${type} schema`;
    case "search_entities": {
      const text = typeof input.text === "string" ? input.text : "";
      return `Searching ${type} for "${text}"`;
    }
    case "read_entity": {
      const id = typeof input.id === "string" ? input.id : "";
      return `Reading ${type} · ${id}`;
    }
    case "traverse": {
      const from = typeof input.from === "string" ? input.from : "";
      const via = typeof input.via === "string" ? input.via : "";
      return `Traversing ${from} → ${via}`;
    }
    default:
      return `Running ${tool}`;
  }
}
