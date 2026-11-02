import { jsonEqual } from "./deep-equal";

/** One top-level BlockNote block; its children are part of it. Only `id` is read. */
export type Block = { id: string; [key: string]: unknown };

/** Which side wins a conflicting block (and a conflicting order) once the GM has chosen. */
export type BlockPreference = "mine" | "theirs";

/**
 * Block-by-block three-way merge of one rich-text field (BlockNote document).
 *
 * Blocks are compared by id as objects, never turned into text. Starting from the
 * server's blocks (theirs):
 * - a block changed only on the device takes the device's version;
 * - a block removed on one side and untouched on the other is removed;
 * - a block added on the device lands after the block that precedes it on the device;
 * - a block changed on both sides (differently), or removed on one side and changed on
 *   the other, is a conflict: the merged document keeps the server's version and its
 *   id is listed in `conflictBlockIds`;
 * - order: when only one side moved blocks, the merged document follows that side's order
 *   (the blocks' content still merges as above); when both sides moved blocks into different
 *   orders, `orderConflict` is true and the server's order is kept.
 *
 * With `prefer: "mine"` (the GM chose this device's version of the field) every conflict
 * resolves to the device's side instead (its block, its removal, its order) and nothing is
 * reported; `prefer: "theirs"` resolves them to the server's side.
 */
export function mergeBlocks(p: { base: Block[]; mine: Block[]; theirs: Block[]; prefer?: BlockPreference }): {
  merged: Block[];
  conflictBlockIds: string[];
  orderConflict: boolean;
} {
  const base = new Map(p.base.map((b) => [b.id, b]));
  const mine = new Map(p.mine.map((b) => [b.id, b]));
  const theirs = new Map(p.theirs.map((b) => [b.id, b]));
  const preferMine = p.prefer === "mine";
  const report = p.prefer === undefined;

  const merged: Block[] = [...p.theirs];
  const conflictBlockIds: string[] = [];
  /** Device blocks missing from `merged` that the device's version brings back. */
  const restore = new Set<string>();
  const indexOf = (id: string) => merged.findIndex((b) => b.id === id);
  const conflict = (id: string, takeMine: () => void) => {
    if (preferMine) takeMine();
    else if (report) conflictBlockIds.push(id);
  };

  for (const [id, baseBlock] of base) {
    const mineBlock = mine.get(id);
    const theirsBlock = theirs.get(id);
    const mineChanged = mineBlock !== undefined && !jsonEqual(mineBlock, baseBlock);
    const theirsChanged = theirsBlock !== undefined && !jsonEqual(theirsBlock, baseBlock);
    const mineRemoved = mineBlock === undefined;
    const theirsRemoved = theirsBlock === undefined;

    if (mineRemoved) {
      if (theirsRemoved) continue;
      if (theirsChanged) conflict(id, () => merged.splice(indexOf(id), 1));
      else merged.splice(indexOf(id), 1);
      continue;
    }

    if (!mineChanged) continue;

    if (theirsRemoved) {
      conflict(id, () => restore.add(id));
      continue;
    }

    if (theirsChanged) {
      if (!jsonEqual(mineBlock, theirsBlock)) conflict(id, () => (merged[indexOf(id)] = mineBlock));
      continue;
    }

    merged[indexOf(id)] = mineBlock;
  }

  // Order of the blocks every side still holds.
  const common = (list: Block[]) =>
    list.map((b) => b.id).filter((id) => base.has(id) && mine.has(id) && theirs.has(id));
  const baseOrder = common(p.base);
  const mineOrder = common(p.mine);
  const theirsOrder = common(p.theirs);
  const mineMoved = !jsonEqual(mineOrder, baseOrder);
  const theirsMoved = !jsonEqual(theirsOrder, baseOrder);
  const bothMovedDifferently = mineMoved && theirsMoved && !jsonEqual(mineOrder, theirsOrder);
  const orderConflict = report && bothMovedDifferently;

  if ((mineMoved && !theirsMoved) || (bothMovedDifferently && preferMine)) {
    // The slots those blocks hold in `merged` take the device's order; every other block stays put.
    const commonSet = new Set(mineOrder);
    const byId = new Map(merged.map((b) => [b.id, b]));
    let next = 0;
    for (let index = 0; index < merged.length; index++)
      if (commonSet.has(merged[index].id)) merged[index] = byId.get(mineOrder[next++])!;
  }

  // Blocks the device added (or brings back): each lands after the block that precedes it on the device.
  let previousId: string | undefined;
  for (const mineBlock of p.mine) {
    const id = mineBlock.id;
    if (!base.has(id) || restore.has(id)) {
      const at = indexOf(id);
      if (at !== -1) {
        if (!jsonEqual(merged[at], mineBlock)) conflict(id, () => (merged[at] = mineBlock));
      } else {
        const insertAt = previousId === undefined ? 0 : indexOf(previousId) + 1;
        merged.splice(insertAt, 0, mineBlock);
      }
    }
    if (indexOf(id) !== -1) previousId = id;
  }

  return { merged, conflictBlockIds, orderConflict };
}
