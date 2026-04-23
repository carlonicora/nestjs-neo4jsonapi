#!/usr/bin/env node
import { Command } from "commander";
import * as fs from "fs";
import * as path from "path";

const DEFAULT_SKIP_ENTITIES = [
  "Entity", "Auth", "AuthCode", "Push", "S3", "OneTimeToken",
  "Configuration", "Module", "Feature", "Role", "Company",
  "Audit", "Notification", "Webhook",
];

interface RelationshipInfo {
  targetEntity: string;
  direction: "in" | "out";
  relationship: string;
  fieldName: string;
}

interface EntityInfo {
  name: string;
  labelName: string;
  relationships: RelationshipInfo[];
}

const program = new Command();

program
  .name("generate-rbac-paths")
  .description("Generate MODULE_USER_PATHS map from entity descriptors")
  .option("--dir <path>", "Directory of compiled descriptors", "dist/features")
  .option("--output <path>", "Output file path", "src/features/rbac/module-relationships.map.ts")
  .option("--skip <names>", "Comma-separated entity names to skip", "")
  .option("--max-depth <n>", "BFS max depth", "4")
  .option("--module-id-map <path>", "Path to labelName→UUID JSON map (required for UUID-keyed output)", "")
  .parse();

function scanDescriptors(dir: string, skipEntities: string[]): EntityInfo[] {
  const entities: EntityInfo[] = [];
  const files = getAllFiles(dir, ".js");

  for (const file of files) {
    try {
      const mod = require(path.resolve(file));
      for (const exportName of Object.keys(mod)) {
        const exported = mod[exportName];
        if (exported?.model?.labelName && exported?.relationships) {
          const labelName = exported.model.labelName;
          if (skipEntities.includes(labelName)) continue;

          const relationships: RelationshipInfo[] = [];
          for (const [key, rel] of Object.entries(exported.relationships)) {
            const r = rel as any;
            if (r?.model?.labelName) {
              relationships.push({
                targetEntity: r.model.labelName,
                direction: r.direction ?? "out",
                relationship: r.relationship ?? key.toUpperCase(),
                fieldName: key,
              });
            }
          }

          entities.push({ name: labelName, labelName, relationships });
        }
      }
    } catch {
      // Skip files that can't be loaded
    }
  }

  return entities;
}

function getAllFiles(dir: string, ext: string): string[] {
  const results: string[] = [];
  if (!fs.existsSync(dir)) return results;

  const entries = fs.readdirSync(dir, { withFileTypes: true });
  for (const entry of entries) {
    const fullPath = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      results.push(...getAllFiles(fullPath, ext));
    } else if (entry.name.endsWith(ext)) {
      results.push(fullPath);
    }
  }
  return results;
}

function buildGraph(entities: EntityInfo[]): Map<string, RelationshipInfo[]> {
  const graph = new Map<string, RelationshipInfo[]>();
  for (const entity of entities) {
    graph.set(entity.labelName, entity.relationships);
  }
  return graph;
}

function bfsToUser(
  graph: Map<string, RelationshipInfo[]>,
  startEntity: string,
  maxDepth: number,
): string[] {
  if (startEntity === "User") return [];

  const paths: string[] = [];
  const queue: Array<{ entity: string; path: string[]; depth: number }> = [
    { entity: startEntity, path: [], depth: 0 },
  ];
  const visited = new Set<string>();
  visited.add(startEntity);

  while (queue.length > 0) {
    const { entity, path: currentPath, depth } = queue.shift()!;
    if (depth >= maxDepth) continue;

    const relationships = graph.get(entity) ?? [];
    for (const rel of relationships) {
      if (visited.has(rel.targetEntity) && rel.targetEntity !== "User") continue;

      const newPath = [...currentPath, rel.fieldName];

      if (rel.targetEntity === "User") {
        paths.push(newPath.join("."));
      } else {
        visited.add(rel.targetEntity);
        queue.push({
          entity: rel.targetEntity,
          path: newPath,
          depth: depth + 1,
        });
      }
    }
  }

  return paths;
}

async function main() {
  const options = program.opts();
  const dir = options.dir as string;
  const output = options.output as string;
  const maxDepth = parseInt(options.maxDepth as string, 10);
  const extraSkip = (options.skip as string)
    .split(",")
    .map((s: string) => s.trim())
    .filter(Boolean);
  const skipEntities = [...DEFAULT_SKIP_ENTITIES, ...extraSkip];

  const moduleIdMapPath: string = options.moduleIdMap as string;
  if (!moduleIdMapPath) {
    console.error("--module-id-map is required. See apps/api/scripts/build-module-id-map.ts.");
    process.exit(1);
  }
  const moduleIdMap: Record<string, string> = JSON.parse(fs.readFileSync(moduleIdMapPath, "utf8"));

  console.info("\nRBAC Path Generation CLI");
  console.info("========================\n");
  console.info(`Scanning: ${dir}`);
  console.info(`Output: ${output}`);
  console.info(`Max depth: ${maxDepth}`);
  console.info(`Module id map: ${moduleIdMapPath}`);
  console.info(`Skip entities: ${skipEntities.join(", ")}\n`);

  const entities = scanDescriptors(dir, skipEntities);
  console.info(`Found ${entities.length} entities\n`);

  const graph = buildGraph(entities);
  const entitiesByLabel = new Map<string, EntityInfo>();
  const pathsByEntity = new Map<string, string[]>();

  for (const entity of entities) {
    entitiesByLabel.set(entity.labelName, entity);
    const paths = bfsToUser(graph, entity.labelName, maxDepth);
    pathsByEntity.set(entity.labelName, paths);
    if (paths.length > 0) {
      console.info(`  ${entity.labelName}: [${paths.join(", ")}]`);
    }
  }

  // Ensure every mapped module has an entry (possibly empty)
  const finalMap: Record<string, readonly string[]> = {};
  for (const [labelName, uuid] of Object.entries(moduleIdMap)) {
    const entity = entitiesByLabel.get(labelName);
    finalMap[uuid] = entity ? Array.from(pathsByEntity.get(labelName) ?? []) : [];
  }

  const content =
    `// Auto-generated by generate-rbac-paths CLI tool\n` +
    `// Do not edit manually - regenerate with: pnpm generate:rbac-paths\n\n` +
    `export const MODULE_USER_PATHS = ${JSON.stringify(finalMap, null, 2)} as const;\n\n` +
    `export type ModuleUserPathsType = typeof MODULE_USER_PATHS;\n`;

  const outputDir = path.dirname(output);
  if (!fs.existsSync(outputDir)) {
    fs.mkdirSync(outputDir, { recursive: true });
  }
  fs.writeFileSync(output, content, "utf-8");

  console.info(`\nGenerated ${output} with ${Object.keys(finalMap).length} module entries\n`);
}

main().catch((error) => {
  console.error("\nGeneration failed:", error.message);
  if (process.env.DEBUG) {
    console.error(error.stack);
  }
  process.exit(1);
});
