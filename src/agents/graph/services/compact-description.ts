import type { FieldKind } from "../../../common/interfaces/entity.schema.interface";

/** One described field, as `describe_entity` builds it. */
export interface EntityFieldDescription {
  name: string;
  type: string;
  description: string;
  filterable: boolean;
  sortable: boolean;
  /** Filter operators the field accepts; empty when it cannot be filtered. */
  operators: string[];
  /** The only values the type's service accepts on this field. */
  values?: string[];
  kind?: FieldKind;
  /** Wire format of a richtext field: read and written as markdown. */
  format?: "markdown";
  /** Present only when the type declares a list stage. */
  stage?: "list" | "detail";
  /** Present only when the type is writable. */
  writable?: boolean;
}

/** One described relationship, as `describe_entity` builds it. */
export interface EntityRelationshipDescription {
  name: string;
  /** `"*"` for a polymorphic relationship: each result carries its own type. */
  targetType: string;
  cardinality: "one" | "many";
  description: string;
  /** Present only when the type is writable. */
  writable?: boolean;
}

/** A field filled by the type's service on `read_entity` only. */
export interface EntityDetailFieldDescription {
  name: string;
  type: string;
  description: string;
  availableOn: "read_entity";
}

/**
 * Everything `describe_entity` knows about one type: the structured form that
 * {@link renderCompactDescriptions} turns into text.
 */
export interface EntityDescription {
  type: string;
  description: string;
  fields: EntityFieldDescription[];
  relationships: EntityRelationshipDescription[];
  detailFields?: EntityDetailFieldDescription[];
  bridge?: { materialiseTo: string[] };
}

/**
 * Shorter descriptions stay inline even when repeated: a reference to the
 * shared entry would save next to nothing and cost the reader a lookup.
 */
const MIN_SHARED_DESCRIPTION_LENGTH = 20;

/** The reading guide, one entry per convention. Order is the printed order. */
const GUIDE = {
  lines:
    "Fields: name (type) [marks]: description. Relationships: name -> target type (one or many) [marks]: description.",
  shared: "see Dn: the shared description Dn below.",
  filter: "filter On: filterable with the operators of list On below. No filter mark: not filterable.",
  filterOdd:
    "filterable, no operators: counts as filterable but accepts no operator. not filterable, operators On: lists operators yet is not filterable.",
  sort: "Filterable fields are sortable unless marked no sort; other fields are not sortable unless marked sort.",
  values: "values [...]: the only values accepted.",
  money: "money(N): an integer in minor units with N decimals (divide by 10^N to display); plain money: 2 decimals.",
  richtext: "richtext: rich text. markdown: read and written as markdown.",
  list: "list stage (on a type): search_entities and traverse return only the fields marked list; read_entity returns all.",
  writable: "writable (on a type): the write tools may set only the fields and relationships marked writable.",
  polymorphic: "-> *: records of any type; each result carries its own type.",
  detail: "Detail fields: returned only by the tool in their heading; never filtered, sorted, searched or listed.",
  bridge: "Bridge, materialiseTo: a junction type; its reads inline the targets of the named relationships.",
} as const;

type GuideKey = keyof typeof GUIDE;

/** Guide lines for marks the description builder never produces today: printed only when a type uses them. */
const ONLY_WHEN_USED = new Set<GuideKey>(["filterOdd"]);

/** Code-unit order: identical on every machine, whatever the locale. */
const byCodeUnit = (a: string, b: string): number => (a < b ? -1 : a > b ? 1 : 0);

const isWritableType = (d: EntityDescription): boolean =>
  d.fields.some((f) => f.writable !== undefined) || d.relationships.some((r) => r.writable !== undefined);

const hasListStage = (d: EntityDescription): boolean => d.fields.some((f) => f.stage !== undefined);

function moneyMark(kind: FieldKind): string {
  return kind.type === "money" && kind.minorUnits !== undefined ? `money(${kind.minorUnits})` : "money";
}

/**
 * Renders type descriptions as compact text for a model to read. Lossless:
 * every attribute of the structured form survives. Repetition is stated once
 * in a preamble and referenced by name:
 * - a description used two or more times (fields, relationships and detail
 *   fields alike) becomes a shared entry `D<n>`;
 * - each distinct filter-operator list becomes `O<n>`; a field that cannot be
 *   filtered shows none;
 * - flags appear only where they differ from the defaults the guide states.
 *
 * Entry names are numbered in content order, never input order, so a type's
 * block does not change when the input is reordered. The type blocks keep the
 * input order. Same input, same text.
 *
 * `standalone: true` (one `describe_entity` result) prints only the guide
 * lines the given types use; `standalone: false` (a catalog of many types)
 * prints the whole guide (bar the lines for marks the builder never produces),
 * so the conventions read the same whatever types a user can see. The shared
 * entries are always exactly those the given types reference, so the output
 * never refers to a part it does not define.
 */
export function renderCompactDescriptions(descriptions: EntityDescription[], options: { standalone: boolean }): string {
  // Shared descriptions: counted across every described part of every type.
  const counts = new Map<string, number>();
  const count = (text: string): void => {
    if (text.length >= MIN_SHARED_DESCRIPTION_LENGTH) counts.set(text, (counts.get(text) ?? 0) + 1);
  };
  for (const d of descriptions) {
    for (const f of d.fields) count(f.description);
    for (const r of d.relationships) count(r.description);
    for (const f of d.detailFields ?? []) count(f.description);
  }
  const sharedTexts = [...counts.entries()]
    .filter(([, n]) => n >= 2)
    .map(([text]) => text)
    .sort(byCodeUnit);
  const sharedId = new Map(sharedTexts.map((text, i) => [text, `D${i + 1}`]));

  const operatorLists = [
    ...new Set(
      descriptions.flatMap((d) => d.fields.filter((f) => f.operators.length).map((f) => f.operators.join(", "))),
    ),
  ].sort(byCodeUnit);
  const operatorId = new Map(operatorLists.map((list, i) => [list, `O${i + 1}`]));

  const used = new Set<GuideKey>(["lines", "sort"]);
  const describe = (text: string): string => {
    const id = sharedId.get(text);
    if (!id) return text;
    used.add("shared");
    return `see ${id}`;
  };
  const tail = (marks: string[], text: string): string =>
    `${marks.length ? ` [${marks.join(", ")}]` : ""}${text ? `: ${describe(text)}` : ""}`;

  const blocks = descriptions.map((d) => {
    const writableType = isWritableType(d);
    const listStage = hasListStage(d);
    const typeMarks: string[] = [];
    if (writableType) {
      typeMarks.push("writable");
      used.add("writable");
    }
    if (listStage) {
      typeMarks.push("list stage");
      used.add("list");
    }
    const lines = [`## ${d.type}${typeMarks.length ? ` [${typeMarks.join(", ")}]` : ""}`];
    if (d.description) lines.push(d.description);
    if (d.bridge) {
      lines.push(`Bridge, materialiseTo: ${d.bridge.materialiseTo.join(", ")}`);
      used.add("bridge");
    }

    if (d.fields.length) {
      lines.push("Fields:");
      for (const f of d.fields) {
        const marks: string[] = [];
        const ops = f.operators.length ? operatorId.get(f.operators.join(", "))! : undefined;
        if (f.filterable && ops) {
          marks.push(`filter ${ops}`);
          used.add("filter");
        } else if (f.filterable || ops) {
          // Unreachable from describe_entity today; kept so the form stays lossless.
          marks.push(f.filterable ? "filterable, no operators" : `not filterable, operators ${ops}`);
          used.add("filterOdd");
        }
        // Default: sortable exactly when filterable. Only exceptions are marked.
        if (f.filterable && !f.sortable) marks.push("no sort");
        if (!f.filterable && f.sortable) marks.push("sort");
        if (f.values?.length) {
          marks.push(`values ${JSON.stringify(f.values)}`);
          used.add("values");
        }
        if (f.kind?.type === "money") {
          marks.push(moneyMark(f.kind));
          used.add("money");
        }
        if (f.kind?.type === "richtext") {
          marks.push("richtext");
          used.add("richtext");
        }
        if (f.format === "markdown") {
          marks.push("markdown");
          used.add("richtext");
        }
        if (f.stage === "list") marks.push("list");
        if (f.writable) marks.push("writable");
        lines.push(`- ${f.name} (${f.type})${tail(marks, f.description)}`);
      }
    }

    if (d.relationships.length) {
      lines.push("Relationships:");
      for (const r of d.relationships) {
        if (r.targetType === "*") used.add("polymorphic");
        lines.push(
          `- ${r.name} -> ${r.targetType} (${r.cardinality})${tail(r.writable ? ["writable"] : [], r.description)}`,
        );
      }
    }

    if (d.detailFields?.length) {
      used.add("detail");
      const where = [...new Set(d.detailFields.map((f) => f.availableOn))].sort(byCodeUnit).join(", ");
      lines.push(`Detail fields, ${where} only:`);
      for (const f of d.detailFields) lines.push(`- ${f.name} (${f.type})${tail([], f.description)}`);
    }
    return lines.join("\n");
  });

  const guide = (Object.keys(GUIDE) as GuideKey[])
    .filter((key) => used.has(key) || (!options.standalone && !ONLY_WHEN_USED.has(key)))
    .map((key) => `- ${GUIDE[key]}`);
  const preamble = ["How to read the type descriptions:", ...guide];
  if (operatorLists.length) {
    preamble.push("Operator lists:", ...operatorLists.map((list) => `- ${operatorId.get(list)}: ${list}`));
  }
  if (sharedTexts.length) {
    preamble.push("Shared descriptions:", ...sharedTexts.map((text) => `- ${sharedId.get(text)}: ${text}`));
  }
  return [preamble.join("\n"), ...blocks].join("\n\n");
}
