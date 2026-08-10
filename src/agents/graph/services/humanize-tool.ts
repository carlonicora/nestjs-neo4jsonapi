/**
 * Humanise a tool invocation into a user-facing status string.
 * Used by GraphNodeService to emit `assistant:status` socket events before each
 * tool call. Falls back to `Running <toolName>` for tools we haven't explicitly
 * labelled — the UI still gets a progress hint, and the assistant turn
 * continues regardless.
 *
 * The id-taking tools (read_entity, traverse) receive only a uuid in their
 * input, which is meaningless on screen. `labels` carries id → human label
 * pairs harvested by collectEntityLabels() from the results of the tool calls
 * made earlier in the same turn — resolve_entity almost always runs first, so
 * by the time a record is read its name is known. When it isn't, the status
 * omits the identifier rather than showing a raw uuid.
 */
export function humanizeTool(
  tool: string,
  input: Record<string, unknown>,
  labels?: ReadonlyMap<string, string>,
): string {
  const type = typeof input.type === "string" ? input.type : "";
  switch (tool) {
    case "resolve_entity": {
      const text = typeof input.text === "string" ? input.text : "";
      return `Resolving "${text}"`;
    }
    case "describe_entity":
      return `Looking up ${type} schema`;
    case "search_entities":
      return `Searching ${type}`;
    case "read_entity": {
      const id = typeof input.id === "string" ? input.id : "";
      const label = labels?.get(id);
      return label ? `Reading ${type} · ${label}` : `Reading ${type}`;
    }
    case "traverse": {
      // Keys must match traverseInputSchema — {fromType, fromId, relationship}.
      const fromType = typeof input.fromType === "string" ? input.fromType : "";
      const fromId = typeof input.fromId === "string" ? input.fromId : "";
      const relationship = typeof input.relationship === "string" ? input.relationship : "";
      const from = labels?.get(fromId) ?? fromType;
      return `Traversing ${from} → ${relationship}`;
    }
    default:
      return `Running ${tool}`;
  }
}

const MAX_WALK_DEPTH = 6;

/** Best human label carried by a single result node, if any. */
function labelOf(node: Record<string, unknown>): string | undefined {
  const candidates: unknown[] = [node.summary, node.name];
  const fields = node.fields;
  if (fields && typeof fields === "object" && !Array.isArray(fields)) {
    candidates.push((fields as Record<string, unknown>).name);
  }
  for (const candidate of candidates) {
    if (typeof candidate === "string" && candidate.trim()) return candidate.trim();
  }
  return undefined;
}

function walk(node: unknown, into: Map<string, string>, depth: number): void {
  if (depth > MAX_WALK_DEPTH || node === null || typeof node !== "object") return;

  if (Array.isArray(node)) {
    for (const item of node) walk(item, into, depth + 1);
    return;
  }

  const record = node as Record<string, unknown>;
  const id = record.id;
  if (typeof id === "string" && id && !into.has(id)) {
    const label = labelOf(record);
    // GraphSearchService.projectSummary falls back to the id when an entity
    // has no summary and no name — storing that would just reprint the uuid.
    if (label && label !== id) into.set(id, label);
  }

  for (const value of Object.values(record)) walk(value, into, depth + 1);
}

/**
 * Harvest id → human label pairs out of a graph tool result so later status
 * lines in the same turn can name the records they touch. Accepts the raw tool
 * return value, which the graph tools serialise to a JSON string. First label
 * seen for an id wins — resolve_entity/search_entities summaries come from the
 * descriptor's own `summary()` and are the most deliberate labels available.
 */
export function collectEntityLabels(result: unknown, into: Map<string, string>): void {
  let payload = result;
  if (typeof payload === "string") {
    try {
      payload = JSON.parse(payload);
    } catch {
      return;
    }
  }
  walk(payload, into, 0);
}
