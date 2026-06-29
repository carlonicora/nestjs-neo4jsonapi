export interface MigrationInterface {
  query: string;
  queryParams?: Record<string, any>;
}

/**
 * A single migration step. `cypher` runs a query in the migration transaction;
 * `s3-upload` streams a local file to S3 before the transaction commits.
 * Apps that only run Cypher can keep exporting `MigrationInterface[]`.
 */
export type MigrationStep =
  | { kind: "cypher"; query: string; queryParams?: Record<string, any> }
  | { kind: "s3-upload"; localPath: string; s3Key: string; contentType: string };

export type MigrationModule = { migration: MigrationInterface[] } | { migration: MigrationStep[] };
