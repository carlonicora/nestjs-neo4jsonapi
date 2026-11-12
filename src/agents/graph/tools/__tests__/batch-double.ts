import { vi } from "vitest";

type FindRecordById = (params: { id: string }) => Promise<any>;

/** A `findRecordsByIds` double answering through the double's own `findRecordById`, as the AbstractService default does. */
export const batchFrom = (findRecordById: FindRecordById) =>
  vi.fn(async ({ ids }: { ids: string[] }) => {
    const found: Array<{ id: string; record: any }> = [];
    for (const id of ids) {
      const record = await findRecordById({ id });
      if (record) found.push({ id, record });
    }
    return found;
  });

/** The service double with a `findRecordsByIds` built on its `findRecordById`. */
export const withBatch = <S extends { findRecordById: FindRecordById }>(svc: S) => ({
  ...svc,
  findRecordsByIds: batchFrom(svc.findRecordById),
});
