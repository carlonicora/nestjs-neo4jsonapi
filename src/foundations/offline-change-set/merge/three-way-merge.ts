import { jsonEqual } from "./deep-equal";
import { Block, mergeBlocks } from "./merge-blocks";

/** A JSON:API resource object as the wire carries it (only attributes and relationships are read). */
export type Resource = {
  type?: string;
  id?: string;
  attributes?: Record<string, unknown>;
  relationships?: Record<string, unknown>;
  [key: string]: unknown;
};

type Identifier = { type?: string; id: string; meta?: Record<string, unknown>; [key: string]: unknown };
type RelationshipObject = {
  data?: Identifier | Identifier[] | null;
  meta?: Record<string, unknown>;
  [key: string]: unknown;
};

/** Whose value a conflicting field takes once the GM has chosen. */
export type FieldChoice = "mine" | "theirs" | "merged";

/** The GM's answer to an earlier conflict on this record. */
export type MergeResolution = {
  /** Per conflicting field (attribute or relationship name). */
  choices?: Record<string, FieldChoice>;
  /** The choice of every conflicting field `choices` does not name ("Keep mine" = "mine"). */
  all?: FieldChoice;
  /** The resource holding the hand-merged values of the fields chosen "merged". */
  merged?: Resource;
};

export type ThreeWayMergeResult = {
  /** Every attribute of the server's record, with what the merge settled in place. */
  attributes: Record<string, unknown>;
  /** Every relationship the device sent, with the merged linkage (and edge props in `meta`). */
  relationships: Record<string, unknown>;
  /** Attribute and relationship names the save must write (never one only the server changed). */
  changed: string[];
  /** Attribute and relationship names both sides changed differently (and no choice settles). */
  conflictFields: string[];
  /** Rich-text field → conflicting block ids. */
  conflictBlocks: Record<string, string[]>;
};

/** Rich text travels as the JSON string the model wrote. `undefined` when it is not a block array. */
function parseBlocks(value: unknown): Block[] | undefined {
  if (value === undefined || value === null || value === "") return [];
  if (Array.isArray(value)) return value as Block[];
  if (typeof value !== "string") return undefined;
  try {
    const parsed = JSON.parse(value);
    return Array.isArray(parsed) ? (parsed as Block[]) : undefined;
  } catch {
    return undefined;
  }
}

function linkage(rel: unknown): Identifier[] | Identifier | null | undefined {
  if (!rel || typeof rel !== "object" || !("data" in rel)) return undefined;
  return (rel as RelationshipObject).data ?? null;
}

const idsOf = (data: Identifier[] | Identifier | null | undefined): string[] =>
  data == null ? [] : Array.isArray(data) ? data.map((d) => d.id) : [data.id];

const isObject = (value: unknown): value is Record<string, unknown> =>
  !!value && typeof value === "object" && !Array.isArray(value);

/**
 * The edge props a side holds for one linked id: the identifier's `meta`, or (to-one) the
 * relationship's `meta`. `undefined` when that side says nothing about them.
 */
function propsOf(rel: unknown, id: string): Record<string, unknown> | undefined {
  const data = linkage(rel);
  if (data == null) return undefined;
  const item = (Array.isArray(data) ? data : [data]).find((d) => d.id === id);
  if (!item) return undefined;
  if (isObject(item.meta)) return item.meta;
  if (!Array.isArray(data) && isObject((rel as RelationshipObject).meta)) return (rel as RelationshipObject).meta;
  return undefined;
}

/**
 * Three-way merge of one record: base (the record at the last sync), mine (the document the
 * device's model built) and theirs (the record on the server now). Only fields the device
 * sent are considered; a field only the server changed is kept and never written.
 *
 * - Only one side changed a field → that side.
 * - Both changed a plain field to different values → conflict.
 * - Both changed a rich-text field → block-by-block merge (`mergeBlocks`, block order included).
 * - Relationships never conflict: ids added or removed on only one side are applied; edge
 *   props (`meta`) changed on only one side are applied; when both sides changed the same
 *   link's props, the device's win (the GM's later edit).
 * - A relationship missing from theirs (or base) is empty when it is one of
 *   `knownRelationships` (the server always answers those, and omits an empty one);
 *   otherwise it is unknown and treated as unchanged.
 * - `resolution` settles conflicts with the GM's choices: "mine" → the device's value,
 *   "theirs" → the server's (not written), "merged" → the value in `resolution.merged`.
 */
export function threeWayMerge(p: {
  base: Resource;
  mine: Resource;
  theirs: Resource;
  richTextFields: string[];
  knownRelationships?: string[];
  resolution?: MergeResolution;
}): ThreeWayMergeResult {
  const base = p.base?.attributes ?? {};
  const mine = p.mine?.attributes ?? {};
  const theirs = p.theirs?.attributes ?? {};
  const choiceOf = (name: string): FieldChoice | undefined =>
    p.resolution ? (p.resolution.choices?.[name] ?? p.resolution.all) : undefined;
  const mergedAttributes = p.resolution?.merged?.attributes ?? {};

  const attributes: Record<string, unknown> = { ...theirs };
  const changed: string[] = [];
  const conflictFields: string[] = [];
  const conflictBlocks: Record<string, string[]> = {};

  /** Writes `value` when it differs from the server's. */
  const settle = (field: string, value: unknown, differs: boolean) => {
    attributes[field] = value;
    if (differs) changed.push(field);
  };

  for (const field of Object.keys(mine)) {
    const b = base[field];
    const m = mine[field];
    const t = theirs[field];
    const isRichText = p.richTextFields.includes(field);
    const blocks = isRichText ? { b: parseBlocks(b), m: parseBlocks(m), t: parseBlocks(t) } : undefined;
    const asBlocks = blocks && blocks.b && blocks.m && blocks.t ? blocks : undefined;
    const same = (x: unknown, y: unknown, bx?: Block[], by?: Block[]) =>
      asBlocks ? jsonEqual(bx, by) : jsonEqual(x, y);

    if (same(m, b, asBlocks?.m, asBlocks?.b)) continue;

    if (same(t, b, asBlocks?.t, asBlocks?.b)) {
      settle(field, m, true);
      continue;
    }

    if (same(m, t, asBlocks?.m, asBlocks?.t)) continue;

    const choice = choiceOf(field);

    if (asBlocks) {
      const result = mergeBlocks({ base: asBlocks.b, mine: asBlocks.m, theirs: asBlocks.t });
      const conflicting = result.conflictBlockIds.length > 0 || result.orderConflict;
      if (!conflicting) {
        settle(field, JSON.stringify(result.merged), !jsonEqual(result.merged, asBlocks.t));
        continue;
      }
      if (choice === "mine" || choice === "theirs") {
        const chosen = mergeBlocks({ base: asBlocks.b, mine: asBlocks.m, theirs: asBlocks.t, prefer: choice });
        settle(field, JSON.stringify(chosen.merged), !jsonEqual(chosen.merged, asBlocks.t));
        continue;
      }
      if (choice === "merged" && field in mergedAttributes) {
        const value = mergedAttributes[field];
        settle(field, value, !jsonEqual(parseBlocks(value) ?? value, asBlocks.t));
        continue;
      }
      attributes[field] = JSON.stringify(result.merged);
      conflictFields.push(field);
      // A conflicting order is a whole-field choice: no block list for it.
      if (!result.orderConflict) conflictBlocks[field] = result.conflictBlockIds;
      continue;
    }

    if (choice === "mine") settle(field, m, true);
    else if (choice === "theirs") continue;
    else if (choice === "merged" && field in mergedAttributes)
      settle(field, mergedAttributes[field], !jsonEqual(mergedAttributes[field], t));
    else conflictFields.push(field);
  }

  const relationships: Record<string, unknown> = {};
  const baseRels = p.base?.relationships ?? {};
  const theirsRels = p.theirs?.relationships ?? {};
  const known = new Set(p.knownRelationships ?? []);

  for (const [name, mineRel] of Object.entries(p.mine?.relationships ?? {})) {
    const mineData = linkage(mineRel);
    if (mineData === undefined) continue;
    const empty = Array.isArray(mineData) ? [] : null;
    const theirsRel = theirsRels[name] ?? (known.has(name) ? { data: empty } : undefined);
    const baseRel = baseRels[name] ?? (known.has(name) ? { data: empty } : undefined);
    const theirsData = linkage(theirsRel);
    const theirsKnown = theirsData !== undefined;
    const baseData = linkage(baseRel);
    const baseIds = baseData === undefined ? (theirsKnown ? idsOf(theirsData) : []) : idsOf(baseData);
    const theirsIds = theirsKnown ? idsOf(theirsData) : baseIds;

    const identifiers = new Map<string, Identifier>();
    for (const d of [theirsData, mineData]) {
      if (d == null) continue;
      for (const item of Array.isArray(d) ? d : [d]) identifiers.set(item.id, item);
    }

    let resultIds: string[];
    if (Array.isArray(mineData)) {
      const mineIds = mineData.map((d) => d.id);
      const added = mineIds.filter((id) => !baseIds.includes(id));
      const removed = baseIds.filter((id) => !mineIds.includes(id));
      resultIds = [...theirsIds.filter((id) => !removed.includes(id))];
      for (const id of added) if (!resultIds.includes(id)) resultIds.push(id);
    } else {
      const mineId = mineData?.id ?? null;
      const baseId = baseIds[0] ?? null;
      const theirsId = theirsIds[0] ?? null;
      const resultId = mineId === baseId ? theirsId : mineId;
      resultIds = resultId === null ? [] : [resultId];
    }

    // Edge props of every link the result keeps.
    let linkChanged = !jsonEqual([...resultIds].sort(), [...theirsIds].sort());
    const finalProps = new Map<string, Record<string, unknown> | undefined>();
    for (const id of resultIds) {
      const bp = baseIds.includes(id) ? propsOf(baseRel, id) : undefined;
      const mp = propsOf(mineRel, id);
      const tp = theirsIds.includes(id) ? propsOf(theirsRel, id) : undefined;
      const mineChanged = mp !== undefined && !jsonEqual(mp, bp);
      // The device's props when it changed them (also when the server changed them too), else the server's.
      const props = mineChanged ? mp : (tp ?? mp);
      finalProps.set(id, props);
      if (theirsIds.includes(id) && props !== undefined && !jsonEqual(props, tp)) linkChanged = true;
    }

    const identifierOf = (id: string): Identifier => {
      const { meta: _meta, ...identifier } = identifiers.get(id) ?? { id };
      const props = finalProps.get(id);
      return props === undefined ? (identifier as Identifier) : { ...identifier, id, meta: props };
    };

    if (Array.isArray(mineData)) {
      relationships[name] = { ...(mineRel as object), data: resultIds.map(identifierOf) };
    } else {
      const { meta: _relMeta, ...rest } = mineRel as RelationshipObject;
      const data = resultIds.length === 0 ? null : identifierOf(resultIds[0]);
      relationships[name] = data?.meta ? { ...rest, data, meta: data.meta } : { ...rest, data };
    }

    if (linkChanged) changed.push(name);
  }

  return { attributes, relationships, changed, conflictFields, conflictBlocks };
}
