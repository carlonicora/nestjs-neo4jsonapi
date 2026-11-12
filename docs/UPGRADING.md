# Upgrading

This file has one section per version, written by hand next to the generated `CHANGELOG.md`.

## 8.23.0: what its release notes left out

### Wire changes

- "JSON:API meta leaves out null edge properties" applied only to to-many relationships. A to-one edge property that was not stored was still sent as `null`.

### Contract changes

- Chunk gained a computed `score`. It read any column named `score` in the row.
- A polymorphic `read_entity` include and the polymorphic `traverse` call `findRelatedIds` on any source service that implements it.
- The reverse of a relationship still copied the forward cardinality when it declared none. The note "can declare its own cardinality ... instead of copying the forward one" did not change that default.

### Required app actions

None.

### What to look for in your app

None.

## 8.26.0

### Wire changes

- A Chunk read by `ChunkRepository.findChunks`, and any node read through `projectNodeOmitting`, no longer sends a field the node does not store as `null` in its attributes. The field is left out.
- A to-one edge property the edge does not store is left out of the relationship meta.
- A relationship (to-one) or an item (to-many) whose edge stores none of its declared properties carries no `meta`.
- A hand-written serialiser `meta` map is unchanged.
- `externalSourceUnavailableResult`, the tool value of `ToolFactory.capture` and `mcpError` report the error's own `retryable`. It is true unless the error was raised with `retryable: false`.

### Contract changes

- An undeclared `reverse.cardinality` is "many". A reverse that reaches exactly one record must declare "one".
- The Chunk `score` reads only a column named `chunk_score`. It is undefined for a value that is not a finite number.
- `AbstractService.findRecordsByIds({ ids })` returns `{ id, record }` pairs. The default reads `findRecordById` for each id. `read_entity` includes and `traverse` read related records through it, once per type.
- `readScalars` throws, naming the column, for an integer outside the safe range. Its DateTime value is UTC with millisecond precision. The stored offset and anything finer are dropped, as before.
- `projectNodeOmitting` refuses an alias that is not a plain identifier.
- `EntityFactory` drops the null keys of a node-shaped map, so a property the node does not store is absent.
- `ExternalSourceUnavailableError` takes an optional `retryable`. It defaults to true.

### Required app actions

- Declare `reverse.cardinality: "one"` on a reverse that reaches exactly one record; every other reverse needs nothing.
- Name the column `chunk_score` in a query that returns a Chunk with a similarity (`... AS chunk_score`).
- Rename any service method already called `findRecordsByIds` with another return type.
- Raise `ExternalSourceUnavailableError` with `retryable: false` for a source that answered with a defect.

### What to look for in your app

Run each command from the root of your app.

- A reverse with no `cardinality` on a forward `cardinality: "one"` relationship now prints "(many)". Run `grep -rn -B12 "reverse: {" apps/*/src --include='*.ts'`, then read the `cardinality` of each relationship that contains a `reverse` without one.
- A to-one relationship with edge `fields`, whose client may test the edge value for `null`. Run `grep -rn -B8 "fields: \[" apps/*/src --include='*.ts' | grep 'cardinality: "one"'`, then search the web app for `relationships?.<name>?.meta` and `=== null` on those field names.
- A query that returns a Chunk next to a `score` column. Run `grep -rn "AS score" apps/*/src --include='*.ts'`, then keep the rows that return a Chunk.
- A service method named `findRecordsByIds`. Run `grep -rn "findRecordsByIds" apps/*/src --include='*.ts'`.
- A client that tests a Chunk attribute for `null` after a `findChunks` read, and every `readScalars`, `projectNodeOmitting` and `ExternalSourceUnavailableError` use. Run `grep -rn "readScalars\|projectNodeOmitting\|ExternalSourceUnavailableError" apps/*/src --include='*.ts'`.
