import { describe, expect, it } from "vitest";
import { BlockNoteService } from "../../../../core/blocknote/services/blocknote.service";
import { CatalogEntity } from "../../interfaces/graph.catalog.interface";
import { formatMoneyField, LIST_FIELD_MAX_CHARS, ToolFieldFormatterService } from "../field-formatting";

const entity = (over: Partial<CatalogEntity> = {}): CatalogEntity => ({
  type: "things",
  moduleId: "m1",
  description: "d",
  nodeName: "thing",
  labelName: "Thing",
  relationships: [],
  fields: [
    { name: "name", type: "string", description: "d", filterable: true, sortable: true },
    { name: "notes", type: "string", description: "d", filterable: true, sortable: true, kind: { type: "richtext" } },
    {
      name: "price",
      type: "number",
      description: "d",
      filterable: true,
      sortable: true,
      kind: { type: "money", minorUnits: 2 },
    },
    { name: "blurb", type: "string", description: "d", filterable: true, sortable: true },
  ],
  ...over,
});

const BN = JSON.stringify([
  { id: "1", type: "paragraph", props: {}, content: [{ type: "text", text: "Hello world", styles: {} }], children: [] },
]);

const RICH_BN = JSON.stringify([
  {
    id: "h1",
    type: "heading",
    props: { level: 2 },
    content: [{ type: "text", text: "Title", styles: {} }],
    children: [],
  },
  {
    id: "b1",
    type: "bulletListItem",
    props: {},
    content: [{ type: "text", text: "First point", styles: {} }],
    children: [
      {
        id: "p1",
        type: "paragraph",
        props: {},
        content: [{ type: "text", text: "Nested detail", styles: {} }],
        children: [],
      },
    ],
  },
]);

function service(): ToolFieldFormatterService {
  return new ToolFieldFormatterService(new BlockNoteService());
}

describe("ToolFieldFormatterService", () => {
  it("renders a richtext field to markdown", () => {
    const svc = service();
    const result = svc.build({ entity: entity(), record: { notes: BN }, stage: "detail" });
    expect(result.fields.notes).toContain("Hello world");
    expect(result.fields.notes).not.toContain('{"type":"paragraph"');
  });

  it("renders a richer richtext document (heading + bullet list + nested paragraph) with markdown markers", () => {
    const svc = service();
    const result = svc.build({ entity: entity(), record: { notes: RICH_BN }, stage: "detail" });
    const notes = String(result.fields.notes);
    expect(notes).toContain("## Title");
    expect(notes).toContain("- First point");
    expect(notes).toContain("Nested detail");
    expect(notes).not.toContain('"type":"heading"');
  });

  it.each([["[]"], [""], [JSON.stringify([])], [null], [undefined]])(
    "drops empty richtext value %j from both fields and availableOnRead",
    (value) => {
      const svc = service();
      for (const stage of ["list", "detail"] as const) {
        const result = svc.build({ entity: entity(), record: { notes: value }, stage });
        expect(result.fields.notes).toBeUndefined();
        expect(result.availableOnRead ?? []).not.toContain("notes");
      }
    },
  );

  it("passes through malformed richtext (plain prose) unchanged, no throw", () => {
    const svc = service();
    const result = svc.build({ entity: entity(), record: { notes: "plain prose" }, stage: "detail" });
    expect(result.fields.notes).toBe("plain prose");
  });

  it("passes through malformed richtext (invalid JSON array-looking string) unchanged, no throw", () => {
    const svc = service();
    expect(() => svc.build({ entity: entity(), record: { notes: "[not json" }, stage: "detail" })).not.toThrow();
    const result = svc.build({ entity: entity(), record: { notes: "[not json" }, stage: "detail" });
    expect(result.fields.notes).toBe("[not json");
  });

  it("declared chat.list emits exactly those fields, others withheld to availableOnRead", () => {
    const svc = service();
    const declared = entity({ list: ["name", "blurb"] });
    const result = svc.build({
      entity: declared,
      record: { name: "Widget", notes: BN, price: 600, blurb: "short" },
      stage: "list",
    });
    expect(Object.keys(result.fields)).toEqual(["name", "blurb"]);
    expect(result.availableOnRead).toEqual(expect.arrayContaining(["notes", "price"]));
    expect(result.availableOnRead).toHaveLength(2);
  });

  it("declared field over 200 chars is still emitted in full — no backstop", () => {
    const svc = service();
    const long = "x".repeat(5000);
    const declared = entity({ list: ["name", "blurb"] });
    const result = svc.build({ entity: declared, record: { name: "Widget", blurb: long }, stage: "list" });
    expect(result.fields.blurb).toBe(long);
    expect((result.fields.blurb as string).length).toBe(5000);
  });

  it("no chat.list: length default emits at 199/200 chars and withholds at 201", () => {
    const svc = service();
    const undeclared = entity();
    const at199 = svc.build({ entity: undeclared, record: { blurb: "x".repeat(199) }, stage: "list" });
    expect(at199.fields.blurb).toBeDefined();
    expect(at199.availableOnRead ?? []).not.toContain("blurb");

    const at200 = svc.build({ entity: undeclared, record: { blurb: "x".repeat(200) }, stage: "list" });
    expect(at200.fields.blurb).toBeDefined();
    expect(at200.availableOnRead ?? []).not.toContain("blurb");

    const at201 = svc.build({ entity: undeclared, record: { blurb: "x".repeat(201) }, stage: "list" });
    expect(at201.fields.blurb).toBeUndefined();
    expect(at201.availableOnRead).toContain("blurb");
    expect(LIST_FIELD_MAX_CHARS).toBe(200);
  });

  it("stage detail emits every non-empty described field, no availableOnRead key", () => {
    const svc = service();
    const result = svc.build({
      entity: entity(),
      record: { name: "Widget", notes: BN, price: 600, blurb: "x".repeat(5000) },
      stage: "detail",
    });
    expect(Object.keys(result.fields)).toEqual(expect.arrayContaining(["name", "notes", "price", "blurb"]));
    expect(result.availableOnRead).toBeUndefined();
  });

  it("emits a money <name>_formatted companion in both stages, and never in availableOnRead", () => {
    const svc = service();

    const detail = svc.build({ entity: entity(), record: { price: 600 }, stage: "detail" });
    expect(detail.fields.price).toBe(600);
    expect(detail.fields.price_formatted).toBe("6.00");

    const list = svc.build({ entity: entity(), record: { price: 600 }, stage: "list" });
    expect(list.fields.price).toBe(600);
    expect(list.fields.price_formatted).toBe("6.00");

    // Withheld case: declared list excludes price → companion must not leak into availableOnRead.
    const declared = entity({ list: ["name"] });
    const withheld = svc.build({ entity: declared, record: { name: "Widget", price: 600 }, stage: "list" });
    expect(withheld.fields.price).toBeUndefined();
    expect(withheld.fields.price_formatted).toBeUndefined();
    expect(withheld.availableOnRead).toContain("price");
    expect(withheld.availableOnRead).not.toContain("price_formatted");
  });

  it("omits availableOnRead entirely when nothing is withheld", () => {
    const svc = service();
    const result = svc.build({ entity: entity(), record: { name: "Widget" }, stage: "list" });
    expect(result.availableOnRead).toBeUndefined();
  });

  it("never emits a record key that has no matching catalogue field", () => {
    const svc = service();
    const result = svc.build({ entity: entity(), record: { name: "Widget", secret: "x" }, stage: "detail" });
    expect(result.fields.secret).toBeUndefined();
    expect(result.availableOnRead ?? []).not.toContain("secret");
  });

  it("formatMoneyField stays unchanged (re-export sanity)", () => {
    expect(formatMoneyField(600, { type: "money", minorUnits: 2 })).toBe("6.00");
    expect(formatMoneyField(null, { type: "money" })).toBeNull();
  });
});

/**
 * Regression for the 12-session `traverse` tool result that motivated staged
 * list projections: a 347,808-byte payload the model had to swallow whole.
 *
 * The payload below is rebuilt, not captured. The original version of this
 * spec read the real tool result out of a machine-local
 * `apps/api/.llm-dumps/<date>/<uuid>/…` capture, so the regression only ran on
 * the one machine that happened to hold that file and hard-failed in every
 * other checkout. This fixture reproduces what the assertion actually depends
 * on — 12 sessions whose `recap` / `recapEvents` / `recapDebrief` BlockNote
 * documents dominate a >300 KB payload, with only `recapEvents` among the
 * richtext fields declared in `chat.list` — and runs anywhere.
 */
describe("12-session traverse payload", () => {
  const LOREM =
    "lorem ipsum dolor sit amet consectetur adipiscing elit sed do eiusmod tempor incididunt ut labore".split(" ");

  const fillerText = (length: number, seed: number): string => {
    let text = "";
    let index = seed;
    while (text.length < length) text += `${text.length === 0 ? "" : " "}${LOREM[index++ % LOREM.length]}`;
    return text.slice(0, length);
  };

  /** A BlockNote document of `blocks` blocks, each holding `textChars` of prose. */
  const blockNoteDoc = (params: { blocks: number; textChars: number; seed: number }): string =>
    JSON.stringify(
      Array.from({ length: params.blocks }, (_, index) => ({
        id: `${params.seed}-${index}`,
        type: index % 4 === 0 ? "bulletListItem" : "paragraph",
        props: { textColor: "default", backgroundColor: "default", textAlignment: "left" },
        content: [{ type: "text", text: fillerText(params.textChars, params.seed + index), styles: {} }],
        children: [],
      })),
    );

  // Block counts mirror the captured spread: long recaps, mid-length debriefs,
  // and short bullet-per-event lists.
  const items = Array.from({ length: 12 }, (_, index) => ({
    id: `00000000-0000-4000-8000-${String(index).padStart(12, "0")}`,
    type: "sessions",
    summary: `Session ${index + 1}`,
    fields: {
      name: `Session ${index + 1}`,
      description: blockNoteDoc({ blocks: 1, textChars: 180, seed: index }),
      number: index + 1,
      sessionDate: "2026-08-22",
      inGameDate: "1499-03-14",
      recap: blockNoteDoc({ blocks: 36 + ((index * 3) % 12), textChars: 200, seed: 100 + index }),
      recapEvents: blockNoteDoc({ blocks: 14 + ((index * 5) % 24), textChars: 34, seed: 200 + index }),
      recapDebrief: blockNoteDoc({ blocks: 24 + (index % 6), textChars: 75, seed: 300 + index }),
      // Bookkeeping the captured payload also carried, catalogued nowhere.
      recapStatus: "success",
      recapGeneratedAt: "2026-08-22T23:53:39.000Z",
    },
  }));

  const sessionsFixture = entity({
    type: "sessions",
    nodeName: "session",
    labelName: "Session",
    list: ["name", "number", "sessionDate", "inGameDate", "recapEvents"],
    fields: [
      { name: "name", type: "string", description: "d", filterable: true, sortable: true },
      {
        name: "description",
        type: "string",
        description: "d",
        filterable: true,
        sortable: true,
        kind: { type: "richtext" },
      },
      { name: "number", type: "number", description: "d", filterable: true, sortable: true },
      { name: "sessionDate", type: "date", description: "d", filterable: true, sortable: true },
      { name: "inGameDate", type: "date", description: "d", filterable: true, sortable: true },
      {
        name: "recap",
        type: "string",
        description: "d",
        filterable: true,
        sortable: true,
        kind: { type: "richtext" },
      },
      {
        name: "recapEvents",
        type: "string",
        description: "d",
        filterable: true,
        sortable: true,
        kind: { type: "richtext" },
      },
      {
        name: "recapDebrief",
        type: "string",
        description: "d",
        filterable: true,
        sortable: true,
        kind: { type: "richtext" },
      },
    ],
  });

  it("the raw payload is the size that motivated the regression", () => {
    expect(items).toHaveLength(12);
    expect(JSON.stringify({ items }).length).toBeGreaterThan(300_000);
  });

  it("renders the sessions list to under 20 KB (was 347,808 bytes)", () => {
    const svc = service();
    const rebuilt = items.map((item) => ({
      id: item.id,
      type: item.type,
      summary: item.summary,
      ...svc.build({ entity: sessionsFixture, record: item.fields, stage: "list" }),
    }));

    const bytes = JSON.stringify(rebuilt).length;

    console.log(`traverse regression: rebuilt 12-session list = ${bytes} bytes (was 347,808)`);
    expect(bytes).toBeLessThan(20_000);
  });

  it("emits the declared list as markdown and withholds the rest", () => {
    const svc = service();
    const result = svc.build({ entity: sessionsFixture, record: items[0].fields, stage: "list" });

    expect(Object.keys(result.fields)).toEqual(["name", "number", "sessionDate", "inGameDate", "recapEvents"]);
    expect(result.fields.recapEvents).not.toContain('"type":"paragraph"');
    expect(result.availableOnRead).toEqual(expect.arrayContaining(["description", "recap", "recapDebrief"]));
    // Uncatalogued bookkeeping never reaches the model, in either bucket.
    expect(result.fields.recapStatus).toBeUndefined();
    expect(result.availableOnRead).not.toContain("recapStatus");
  });
});
