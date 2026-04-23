// packages/nestjs-neo4jsonapi/src/foundations/rbac/dsl/perm.ts
import { Action, PermToken } from "./types";

type Scoped<A extends Action> = (path: string) => PermToken;

type PermFn<A extends Action> = { action: A; scope: true } & Scoped<A>;

function build<A extends Action>(action: A): PermFn<A> {
  const fn = (path: string): PermToken => ({ action, scope: path });
  return Object.assign(fn, { action, scope: true } as const);
}

const readT = build("read");
const createT = build("create");
const updateT = build("update");
const deleteT = build("delete");

export const perm = {
  read: readT,
  create: createT,
  update: updateT,
  delete: deleteT,
  full: [
    { action: "read", scope: true },
    { action: "create", scope: true },
    { action: "update", scope: true },
    { action: "delete", scope: true },
  ] as PermToken<never>[],
};
