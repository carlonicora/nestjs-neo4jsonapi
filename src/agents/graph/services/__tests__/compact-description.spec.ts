import { describe, expect, it } from "vitest";
import { EntityDescription, renderCompactDescriptions } from "../compact-description";

// Realistic lengths: the shared sentences of a real catalog are this long.
const NAME = "The name of this record, as the game master wrote it. Use it to identify the record to the user.";
const NOTES =
  "The game master's full notes on this record, in rich text. The authoritative source for anything not in another field.";
const SUMMARY =
  "AI-generated summary of the notes, refreshed after every edit. Use it for an overview; quote the notes for detail.";
const RELATED =
  "Records of any type the game master linked to this one by hand. Each result carries its own type; read it to learn more.";
const STRING_OPS = ["eq", "ne", "in", "like", "isNull", "isNotNull"];
const NUMBER_OPS = ["eq", "ne", "in", "gt", "gte", "lt", "lte", "isNull", "isNotNull"];
const DATE_OPS = ["eq", "ne", "gt", "gte", "lt", "lte", "isNull", "isNotNull"];

/**
 * Three types that share the name and notes descriptions, the string operator
 * list and the polymorphic "related" relationship, and that between them carry
 * enum values, a money kind, a richtext field, writable flags, a list stage,
 * detail fields and a bridge.
 */
const npcs: EntityDescription = {
  type: "npcs",
  description: "A non-player character.",
  fields: [
    {
      name: "name",
      type: "string",
      description: NAME,
      filterable: true,
      sortable: true,
      operators: STRING_OPS,
      stage: "list",
      writable: true,
    },
    {
      name: "notes",
      type: "string",
      description: NOTES,
      filterable: false,
      sortable: false,
      operators: [],
      kind: { type: "richtext" },
      format: "markdown",
      stage: "detail",
      writable: true,
    },
    {
      name: "tldr",
      type: "string",
      description: "A one-line summary written by the system.",
      filterable: true,
      sortable: false,
      operators: STRING_OPS,
      stage: "detail",
      writable: false,
    },
    {
      name: "summary",
      type: "string",
      description: SUMMARY,
      filterable: false,
      sortable: false,
      operators: [],
    },
    {
      name: "role",
      type: "string",
      description: "What the npc does in the story.",
      filterable: true,
      sortable: true,
      operators: STRING_OPS,
    },
    {
      name: "status",
      type: "string",
      description: "Whether the npc is alive, dead or missing.",
      filterable: true,
      sortable: true,
      operators: STRING_OPS,
    },
    {
      name: "age",
      type: "number",
      description: "Age in years.",
      filterable: true,
      sortable: true,
      operators: NUMBER_OPS,
    },
    {
      name: "createdAt",
      type: "datetime",
      description: "When the record was created.",
      filterable: true,
      sortable: true,
      operators: DATE_OPS,
    },
    {
      name: "updatedAt",
      type: "datetime",
      description: "When the record last changed.",
      filterable: true,
      sortable: true,
      operators: DATE_OPS,
    },
  ],
  relationships: [
    {
      name: "campaign",
      targetType: "campaigns",
      cardinality: "one",
      description: "The campaign this npc belongs to.",
      writable: false,
    },
    {
      name: "scenes",
      targetType: "scenes",
      cardinality: "many",
      description: "Scenes this npc appears in.",
      writable: true,
    },
    { name: "related", targetType: "*", cardinality: "many", description: RELATED, writable: false },
  ],
};

const items: EntityDescription = {
  type: "items",
  description: "An object the characters can find or buy.",
  fields: [
    { name: "name", type: "string", description: NAME, filterable: true, sortable: true, operators: STRING_OPS },
    {
      name: "price",
      type: "number",
      description: "What the item costs.",
      filterable: true,
      sortable: true,
      operators: NUMBER_OPS,
      kind: { type: "money", minorUnits: 2 },
    },
    {
      name: "rarity",
      type: "string",
      description: "How rare the item is.",
      filterable: true,
      sortable: true,
      operators: ["eq"],
      values: ["common", "rare", "unique"],
    },
    { name: "notes", type: "string", description: NOTES, filterable: false, sortable: false, operators: [] },
    {
      name: "summary",
      type: "string",
      description: SUMMARY,
      filterable: false,
      sortable: false,
      operators: [],
    },
    {
      name: "weight",
      type: "number",
      description: "Weight in kilograms.",
      filterable: true,
      sortable: true,
      operators: NUMBER_OPS,
    },
    {
      name: "category",
      type: "string",
      description: "Kind of item, such as weapon or tool.",
      filterable: true,
      sortable: true,
      operators: STRING_OPS,
    },
    {
      name: "createdAt",
      type: "datetime",
      description: "When the record was created.",
      filterable: true,
      sortable: true,
      operators: DATE_OPS,
    },
    {
      name: "updatedAt",
      type: "datetime",
      description: "When the record last changed.",
      filterable: true,
      sortable: true,
      operators: DATE_OPS,
    },
  ],
  relationships: [{ name: "related", targetType: "*", cardinality: "many", description: RELATED }],
};

const sceneNpcs: EntityDescription = {
  type: "scene-npcs",
  description: "Junction between a scene and an npc.",
  fields: [
    { name: "name", type: "string", description: NAME, filterable: true, sortable: true, operators: STRING_OPS },
    {
      name: "position",
      type: "number",
      description: "Order in the scene.",
      filterable: false,
      sortable: true,
      operators: [],
    },
    {
      name: "summary",
      type: "string",
      description: SUMMARY,
      filterable: false,
      sortable: false,
      operators: [],
    },
    {
      name: "mood",
      type: "string",
      description: "How the npc feels in this scene.",
      filterable: true,
      sortable: true,
      operators: STRING_OPS,
    },
    {
      name: "createdAt",
      type: "datetime",
      description: "When the record was created.",
      filterable: true,
      sortable: true,
      operators: DATE_OPS,
    },
    {
      name: "updatedAt",
      type: "datetime",
      description: "When the record last changed.",
      filterable: true,
      sortable: true,
      operators: DATE_OPS,
    },
  ],
  relationships: [
    { name: "npc", targetType: "npcs", cardinality: "one", description: "The npc in the scene." },
    { name: "related", targetType: "*", cardinality: "many", description: RELATED },
  ],
  detailFields: [{ name: "transcript", type: "string", description: "What was said.", availableOn: "read_entity" }],
  bridge: { materialiseTo: ["npc"] },
};

const fixture = [npcs, items, sceneNpcs];

/** The block of one type: from its heading to the next heading. */
function blockOf(output: string, type: string): string {
  const start = output.indexOf(`## ${type}`);
  expect(start).toBeGreaterThanOrEqual(0);
  const next = output.indexOf("\n## ", start + 1);
  return output.slice(start, next < 0 ? undefined : next).trimEnd();
}

/** The preamble: everything before the first type block. */
const preambleOf = (output: string): string => output.slice(0, output.indexOf("## "));

/** One field or relationship line of a block. */
function lineOf(block: string, name: string): string {
  const line = block.split("\n").find((l) => l.startsWith(`- ${name} `));
  expect(line, `line for ${name}`).toBeDefined();
  return line!;
}

/** Resolves a "see Dn" reference against the preamble, or returns the inline text. */
function descriptionOf(output: string, line: string): string {
  const ref = /: see (D\d+)$/.exec(line);
  if (!ref) return line.slice(line.indexOf("]: ") >= 0 ? line.indexOf("]: ") + 3 : line.indexOf("): ") + 3);
  const entry = preambleOf(output)
    .split("\n")
    .find((l) => l.startsWith(`- ${ref[1]}: `));
  return entry!.slice(`- ${ref[1]}: `.length);
}

/** Resolves an operator-list name to its operators. */
function operatorsOf(output: string, line: string): string[] {
  const ref = /filter (O\d+)/.exec(line);
  if (!ref) return [];
  const entry = preambleOf(output)
    .split("\n")
    .find((l) => l.startsWith(`- ${ref[1]}: `));
  return entry!.slice(`- ${ref[1]}: `.length).split(", ");
}

const count = (haystack: string, needle: string): number => haystack.split(needle).length - 1;

describe("renderCompactDescriptions", () => {
  it("compact form keeps every attribute today's JSON carries", () => {
    const output = renderCompactDescriptions(fixture, { standalone: false });
    for (const d of fixture) {
      const block = blockOf(output, d.type);
      expect(block).toContain(d.description);
      const writableType = d.fields.some((f) => f.writable !== undefined);
      expect(block.split("\n")[0].includes("writable")).toBe(writableType);
      expect(block.split("\n")[0].includes("list stage")).toBe(d.fields.some((f) => f.stage));

      for (const f of d.fields) {
        const line = lineOf(block, f.name);
        expect(line).toContain(`(${f.type})`);
        expect(descriptionOf(output, line)).toBe(f.description);
        expect(operatorsOf(output, line)).toEqual(f.operators);
        expect(/\[[^\]]*filter O\d/.test(line)).toBe(f.filterable && f.operators.length > 0);
        // Sortable defaults to filterable; the exceptions are marked.
        const sortable = f.filterable ? !line.includes("no sort") : /[[ ]sort[,\]]/.test(line);
        expect(sortable).toBe(f.sortable);
        if (f.values) expect(line).toContain(`values ${JSON.stringify(f.values)}`);
        if (f.kind?.type === "money") expect(line).toContain(`money(${f.kind.minorUnits})`);
        if (f.kind?.type === "richtext") expect(line).toContain("richtext");
        if (f.format) expect(line).toContain("markdown");
        expect(/[[ ]list[,\]]/.test(line)).toBe(f.stage === "list");
        expect(/[[ ]writable[,\]]/.test(line)).toBe(f.writable === true);
      }
      for (const r of d.relationships) {
        const line = lineOf(block, r.name);
        expect(line).toContain(`-> ${r.targetType} (${r.cardinality})`);
        expect(descriptionOf(output, line)).toBe(r.description);
        expect(/\[writable\]/.test(line)).toBe(r.writable === true);
      }
      for (const f of d.detailFields ?? []) {
        expect(block).toContain(`Detail fields, ${f.availableOn} only:`);
        const line = lineOf(block, f.name);
        expect(line).toContain(`(${f.type})`);
        expect(descriptionOf(output, line)).toBe(f.description);
      }
      if (d.bridge) expect(block).toContain(`Bridge, materialiseTo: ${d.bridge.materialiseTo.join(", ")}`);
    }
  });

  it("a field description shared by several types appears once", () => {
    const output = renderCompactDescriptions(fixture, { standalone: false });
    expect(count(output, NAME)).toBe(1);
    expect(count(output, NOTES)).toBe(1);
    expect(count(output, RELATED)).toBe(1);
  });

  it("each distinct operator list appears once", () => {
    const output = renderCompactDescriptions(fixture, { standalone: false });
    for (const ops of [STRING_OPS, NUMBER_OPS]) expect(count(output, ops.join(", "))).toBe(1);
    expect(lineOf(blockOf(output, "items"), "rarity")).toMatch(/filter O\d+/);
    // Three filterable string fields share one list name.
    const stringRef = /filter (O\d+)/.exec(lineOf(blockOf(output, "npcs"), "name"))![1];
    expect(lineOf(blockOf(output, "items"), "name")).toContain(`filter ${stringRef}`);
    expect(lineOf(blockOf(output, "scene-npcs"), "name")).toContain(`filter ${stringRef}`);
    expect(lineOf(blockOf(output, "npcs"), "notes")).not.toMatch(/O\d/);
  });

  it("standalone output defines every shared part it refers to", () => {
    const output = renderCompactDescriptions([items], { standalone: true });
    const preamble = preambleOf(output);
    const block = blockOf(output, "items");
    const referenced = new Set([...block.matchAll(/\b([DO]\d+)\b/g)].map((m) => m[1]));
    const defined = new Set([...preamble.matchAll(/^- ([DO]\d+): /gm)].map((m) => m[1]));
    expect(defined).toEqual(referenced);
    // items carries the three operator lists it uses and no description repeated within itself.
    expect(preamble).toContain("eq, ne, in, like, isNull, isNotNull");
    expect(preamble).toContain(NUMBER_OPS.join(", "));
    expect(preamble).not.toContain("Shared descriptions");
    expect(block).toContain(NAME);
    // Only the conventions items uses are explained.
    expect(preamble).toContain("money(N)");
    expect(preamble).not.toContain("materialiseTo");
    expect(preamble).not.toContain("writable");
  });

  it("the output says writable for writable fields and relationships", () => {
    const output = renderCompactDescriptions(fixture, { standalone: false });
    const npcBlock = blockOf(output, "npcs");
    expect(lineOf(npcBlock, "name")).toContain("writable");
    expect(lineOf(npcBlock, "notes")).toContain("writable");
    expect(lineOf(npcBlock, "scenes")).toContain("writable");
    expect(lineOf(npcBlock, "tldr")).not.toContain("writable");
    expect(blockOf(output, "items")).not.toContain("writable");
    expect(renderCompactDescriptions([items], { standalone: true })).not.toContain("writable");
  });

  it("is deterministic", () => {
    const first = renderCompactDescriptions(fixture, { standalone: false });
    expect(renderCompactDescriptions(fixture, { standalone: false })).toBe(first);
    const reordered = renderCompactDescriptions([sceneNpcs, npcs, items], { standalone: false });
    for (const d of fixture) expect(blockOf(reordered, d.type)).toBe(blockOf(first, d.type));
    expect(preambleOf(reordered)).toBe(preambleOf(first));
  });

  it("is smaller than today's JSON", () => {
    const output = renderCompactDescriptions(fixture, { standalone: false });
    expect(output.length).toBeLessThan(JSON.stringify(fixture).length * 0.6);
  });

  it("carries no backtick and no template placeholder", () => {
    const output = renderCompactDescriptions(fixture, { standalone: false });
    expect(output).not.toContain("`");
    expect(output).not.toContain("${");
  });
});
