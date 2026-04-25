# RBAC: how the permissions system works in this project

This document is for a human developer who's just joined the project and
needs to understand how role-based access control is set up here, how to
change it, and what to do when things go sideways.

If you only read one thing, read the next two paragraphs.

---

## The mental model in 60 seconds

There is exactly one source of truth for "who can do what":
**`apps/api/src/rbac/permissions.ts`**. It's a regular TypeScript file in
your repo, committed to git. It declares, role by role and module by
module, what each role is allowed to do.

When the **worker** process boots (not the API — only the worker), it
reads that file, looks at what's currently in Neo4j, computes the
difference, and applies it to the database in a single transaction. So
the file always wins. If you edit the file and restart the worker, the DB
follows. If somebody pokes Neo4j directly, the next worker boot will
quietly undo their changes — unless you first run `pnpm rbac:dump`, which
copies the current DB state back into the file.

That's the whole loop. Edit the file → restart the worker → DB matches.

---

## Why it's set up this way

A few non-obvious choices, briefly:

- **The file is the truth, not the database.** This means RBAC changes
  go through code review, ship with feature branches, and roll back via
  `git revert` like any other change.
- **Only the worker reconciles.** If both the API and the worker tried to
  reconcile, two processes would race on the same writes when you scale.
  The worker is the single quiet writer.
- **No HTTP endpoint dumps the DB to a file.** That would mean a
  production server could, in principle, write a source file. We don't
  want that. The dump is a developer-only command.
- **Administrator is hardwired.** The reconciler never writes
  `HAS_PERMISSIONS` edges for the Administrator role. Admin can do
  everything; that's enforced in code, not in the database. The file
  shows `RoleId.Administrator: perm.full` everywhere just so it reads
  cleanly.

---

## Setting it up the first time (new project, fresh checkout)

You only do this once per environment. After that, the file lives in the
repo and you just edit it.

### 1. Make sure the worker can talk to Neo4j

Your `.env` (at the monorepo root) needs `NEO4J_URI`, `NEO4J_USER`,
`NEO4J_PASSWORD`, and `NEO4J_DATABASE`. If `pnpm --filter neural-erp-api
dev` already starts cleanly, you're set.

### 2. If the file doesn't exist yet, generate it from the database

```bash
pnpm --filter neural-erp-api rbac:dump
```

You'll see something like:

```
Wrote 12345 bytes to /…/apps/api/src/rbac/permissions.ts
```

What this does: connects to Neo4j with the credentials in your `.env`,
reads every `Module` and every `HAS_PERMISSIONS` edge, and writes them
out as a `defineRbac({...})` block in TypeScript. The roles and modules
are referenced by name (`RoleId.WarehouseManager`,
`ModuleId.Part`) instead of raw UUIDs, so the file is readable.

### 3. Commit the file

```bash
git add apps/api/src/rbac/permissions.ts
git commit -m "feat(rbac): add initial permissions matrix"
```

From now on, this file is your source of truth.

### 4. Start the worker and watch it boot

```bash
pnpm --filter neural-erp-api start:worker:dev
```

Expected log line:

```
RBAC reconcile: no changes
```

That means the file and the DB agree (which they should — you just
generated the file from the DB). If you ever see this on a fresh boot
without having edited the file, your DB is consistent with the matrix.

---

## Editing permissions day-to-day

You have two options. Use whichever feels right for the change you're
making.

### Option A: edit the UI, save, restart the worker

1. Run the dev servers (`pnpm dev` in `apps/api`, the web app, and
   `dev:worker` for the worker).
2. Open `http://neural-erp.test:3301/administration/rbac` (or the URL
   for your env).
3. Pick a module from the left sidebar. Click any cell to open the
   picker. Set `true`, `false`, "inherit from defaults", or one or more
   relationship paths.
4. Hit **Save to permissions.ts** in the page header.
5. `git diff apps/api/src/rbac/permissions.ts` — verify your change.
6. Restart the worker. It logs how many edges it changed:

   ```
   RBAC reconcile: 0 defaults changed, 1 edges upserted, 0 edges removed
   ```

7. Commit the diff with a meaningful message.

### Option B: edit the file directly in your editor

For small changes you can just open `apps/api/src/rbac/permissions.ts`
and edit. The shape is:

```ts
export const rbac = defineRbac<typeof MODULE_USER_PATHS>({
  [ModuleId.Part]: {
    default: [perm.read],                              // every role can read
    [RoleId.WarehouseManager]: [
      perm.create,                                     // unconditional
      perm.update("warehouse.managedBy"),              // scoped to a path
    ],
  },
  // ...
});
```

The vocabulary:

- `perm.read`, `perm.create`, `perm.update`, `perm.delete` — unconditional
  permission for that action.
- `perm.full` — shorthand for all four.
- `perm.update("some.path")` — permission *only* for records reachable
  via that relationship path. The path is verified against Neo4j by the
  query layer at request time.
- `default: [...]` is the floor — every role gets these. Per-role entries
  are *additions on top* of defaults, not replacements.

After saving the file, restart the worker. You'll see the same kind of
"X edges upserted" log.

---

## When the database and the file disagree

This happens. Maybe a teammate poked Neo4j directly via Cypher; maybe a
seed script ran; maybe you imported data from another environment.

You have two choices:

- **Take the file's version (default).** Just restart the worker.
  Whatever the file says wins. Anything in the DB that contradicts the
  file goes away.

- **Take the database's version.** Run the dump:

  ```bash
  pnpm --filter neural-erp-api rbac:dump
  git diff apps/api/src/rbac/permissions.ts
  ```

  Now the file matches the DB. Commit if you want to keep those
  changes; `git checkout` the file if you don't.

The dump is **idempotent and safe** — running it twice in a row produces
identical output.

---

## What if `permissions.ts` doesn't exist at all?

Maybe you've checked out a branch where the file isn't there, or you've
just integrated the library in a brand new project.

If you don't import a matrix into `RbacModule.register({...})`, the
reconciler does nothing. It logs:

```
RBAC reconciler: no matrix configured, skipping
```

…and your DB stays exactly as it was. The dev UI loads but shows an
empty matrix, because there's nothing to show. The library never
auto-creates the file for you — you have to run `pnpm rbac:dump`.

This is the safe default: an integration without a matrix file is a
no-op, not a wipe.

---

## What to commit

- ✅ `apps/api/src/rbac/permissions.ts` — yes, always.
- ✅ `apps/api/src/rbac/module-id.map.json` — yes (it's generated, but
  cheap and stable, and committing it keeps the build deterministic).
- ✅ `apps/api/src/features/rbac/module-relationships.map.ts` — yes
  (regenerated by `pnpm generate:rbac-paths`, but committing it speeds
  up cold builds).
- ❌ Anything in `node_modules` or `dist` — no.

The matrix file diff is meant to be human-readable. If your diff is
huge (hundreds of lines for one change), something's off — probably you
didn't pull the latest version of the file before editing, and prettier
reformatted everything.

---

## Troubleshooting

**The worker starts up and crashes on `permissions.ts`.**
The file has a TypeScript error. Most likely cause: someone wrote
`perm.update("somePath")` for a module whose `MODULE_USER_PATHS` doesn't
include that path, AND you have strict path narrowing on (we don't —
we widened it to `string` precisely so this works). If you see this,
look for a literal typo or a stale `permissions.ts` from before a
library version bump.

**The reconciler aborts with "RBAC reconcile aborted — referenced
entities not found in DB".**
The matrix references a role or module UUID that doesn't exist in Neo4j.
Usually means the seed migrations haven't run yet. Run them, then
restart the worker. The reconciler refuses to silently create roles or
modules out of thin air.

**The dev UI shows "Error loading RBAC configuration".**
The API process is down, or `NODE_ENV=production` so the dev controller
isn't registered. Check the API logs.

**I clicked "Save to permissions.ts" in the UI and the file wasn't
written.**
Either the API isn't in dev mode (`NODE_ENV !== "production"` is the
gate), or you're hitting a stale build of the library. Restart the API
dev server.

**My changes in the UI didn't make it into the database.**
Saving in the UI updates the **file**, not the DB. You then need to
restart the worker so it picks up the new file. The web app is
deliberately decoupled from the worker.

**Two workers are running and I'm worried about races.**
Don't be. The reconciler is registered as a worker-only provider. If
you scale workers horizontally, only one will hold the write
transaction at a time; the others will read the canonical state and
no-op.

---

## Quick reference

| I want to... | Run this |
|---|---|
| Generate `permissions.ts` from current DB state | `pnpm --filter neural-erp-api rbac:dump` |
| Apply file changes to the DB | restart the worker (`pnpm --filter neural-erp-api start:worker:dev`) |
| See what edges/defaults will change before applying | edit file → restart worker → read its log line |
| Roll back an RBAC change | `git revert` the commit that touched `permissions.ts`, restart worker |
| Verify the cell I just edited in the UI is in the file | `git diff apps/api/src/rbac/permissions.ts` |
| Sanity-check the file matches the DB right now | run the dump; `git diff` should be empty |

---

## Where the code lives

- **The matrix file** — `apps/api/src/rbac/permissions.ts`
- **The dump script** — `apps/api/scripts/rbac-dump.ts` (delegates to
  the library function `dumpRbacMatrix`)
- **The reconciler** —
  `packages/nestjs-neo4jsonapi/src/foundations/rbac/services/rbac-reconciler.service.ts`
- **The dev controller** (powers the editor UI) —
  `packages/nestjs-neo4jsonapi/src/foundations/rbac/controllers/rbac-dev.controller.ts`
- **The DSL** (`perm`, `defineRbac`) —
  `packages/nestjs-neo4jsonapi/src/foundations/rbac/dsl/`
- **The editor UI** —
  `packages/nextjs-jsonapi/src/features/rbac/components/RbacContainer.tsx`

If you're poking around, that's the order to read them.
