/**
 * Entity Migration CLI - Reference Updater Module
 *
 * Finds and updates external references to old-style entity exports.
 */

import * as fs from "fs";
import { glob } from "glob";
import * as path from "path";
import { AliasModelInfo, Reference, ReferenceUsage } from "./types";

/**
 * Finds all external files that reference the old entity exports.
 */
export async function findExternalReferences(
  entityName: string,
  labelName: string,
  srcDir: string = "src",
  excludePaths: string[] = [],
  aliasModels: AliasModelInfo[] = [],
): Promise<Reference[]> {
  const references: Reference[] = [];

  // Patterns to search for
  const metaName = `${entityName}Meta`;
  const modelName = `${labelName}Model`;
  const entityTypeName = labelName; // e.g., "Article"

  // Build list of all model names (base + aliases) for pattern matching
  const allModelNames = [modelName, ...aliasModels.map((a) => a.modelName)];

  // Normalize exclude paths for comparison
  const normalizedExcludePaths = new Set(excludePaths.map((p) => path.normalize(path.resolve(process.cwd(), p))));

  // Find all TypeScript files (including test files - they may import entities)
  const tsFiles = await glob(`${srcDir}/**/*.ts`, {
    nodir: true,
    cwd: process.cwd(),
  });

  for (const filePath of tsFiles) {
    const absolutePath = path.normalize(path.resolve(process.cwd(), filePath));

    // Skip excluded paths (the entity files being migrated)
    if (normalizedExcludePaths.has(absolutePath)) {
      continue;
    }

    const content = fs.readFileSync(absolutePath, "utf-8");

    // Check if file imports or uses the old exports (model/entity files that will be deleted)
    // Note: We DON'T include ${entityName}.meta because meta files are preserved
    const hasOldPatterns =
      allModelNames.some((name) => content.includes(name)) ||
      content.includes(`${entityName}.entity`) ||
      content.includes(`${entityName}.model`);

    if (!hasOldPatterns) {
      continue;
    }

    // Check if file imports from the meta file - if so, skip metaName replacements
    // since companyMeta is still available from company.meta.ts
    const importsFromMetaFile = content.includes(`${entityName}.meta"`);

    const usages = findUsagesInFile(content, metaName, modelName, labelName, importsFromMetaFile, aliasModels);

    // Find all old imports that need updating (excluding meta file imports)
    const oldImports = extractAllOldImports(content, entityName, metaName, modelName, entityTypeName, aliasModels);

    if (usages.length === 0 && oldImports.length === 0) continue;

    // Calculate new import (pass content to detect entity type usage in return types etc.)
    const newImport = calculateNewImport(oldImports, entityName, labelName, aliasModels, content);

    references.push({
      filePath: absolutePath,
      oldImport: oldImports.join("\n"), // Store all old imports
      newImport,
      usages,
    });
  }

  return references;
}

/**
 * Finds all usages of old exports within a file (excluding import lines).
 * @param skipMetaReplacements - If true, don't replace metaName usages (file imports from .meta.ts)
 */
function findUsagesInFile(
  content: string,
  metaName: string,
  modelName: string,
  labelName: string,
  skipMetaReplacements: boolean = false,
  aliasModels: AliasModelInfo[] = [],
): ReferenceUsage[] {
  const usages: ReferenceUsage[] = [];
  const lines = content.split("\n");
  const descriptorName = `${labelName}Descriptor`;

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const lineNumber = i + 1;

    // Skip import lines (handled separately)
    if (line.trim().startsWith("import ")) continue;

    // Skip export lines (these are definitions, not usages)
    if (line.trim().startsWith("export ")) continue;

    // Check for meta usage patterns (only if not importing from .meta.ts file)
    if (!skipMetaReplacements && line.includes(metaName)) {
      // Pattern: entityMeta.property -> EntityDescriptor.model.property
      const metaPattern = new RegExp(`${metaName}\\.(\\w+)`, "g");
      let match;
      while ((match = metaPattern.exec(line)) !== null) {
        usages.push({
          line: lineNumber,
          oldText: `${metaName}.${match[1]}`,
          newText: `${descriptorName}.model.${match[1]}`,
        });
      }

      // Pattern: standalone metaName usage (not followed by .)
      const standaloneMetaPattern = new RegExp(`\\b${metaName}\\b(?!\\.)`, "g");
      if (standaloneMetaPattern.test(line)) {
        usages.push({
          line: lineNumber,
          oldText: metaName,
          newText: `${descriptorName}.model`,
        });
      }
    }

    // Check for model usage patterns
    if (line.includes(modelName)) {
      // Pattern: EntityModel.property -> EntityDescriptor.model.property
      const modelPropertyPattern = new RegExp(`${modelName}\\.(\\w+)`, "g");
      let match;
      while ((match = modelPropertyPattern.exec(line)) !== null) {
        usages.push({
          line: lineNumber,
          oldText: `${modelName}.${match[1]}`,
          newText: `${descriptorName}.model.${match[1]}`,
        });
      }

      // Pattern: serialiserFactory.create(EntityModel) -> serialiserFactory.create(EntityDescriptor.model)
      if (line.includes(`serialiserFactory.create(${modelName})`)) {
        usages.push({
          line: lineNumber,
          oldText: `serialiserFactory.create(${modelName})`,
          newText: `serialiserFactory.create(${descriptorName}.model)`,
        });
      }

      // Pattern: modelRegistry.register(EntityModel) -> modelRegistry.register(EntityDescriptor.model)
      if (line.includes(`modelRegistry.register(${modelName})`)) {
        usages.push({
          line: lineNumber,
          oldText: `modelRegistry.register(${modelName})`,
          newText: `modelRegistry.register(${descriptorName}.model)`,
        });
      }

      // Pattern: standalone EntityModel usage (not followed by .)
      // But NOT inside a property access pattern we already handled
      if (!line.includes(`${modelName}.`)) {
        const standalonePattern = new RegExp(`\\b${modelName}\\b`, "g");
        if (standalonePattern.test(line)) {
          usages.push({
            line: lineNumber,
            oldText: modelName,
            newText: `${descriptorName}.model`,
          });
        }
      }
    }

    // Check for alias model usage patterns (OwnerModel, AuthorModel, etc.)
    for (const alias of aliasModels) {
      if (line.includes(alias.modelName)) {
        // Pattern: serialiserFactory.create(AliasModel) -> serialiserFactory.create(AliasDescriptor.model)
        if (line.includes(`serialiserFactory.create(${alias.modelName})`)) {
          usages.push({
            line: lineNumber,
            oldText: `serialiserFactory.create(${alias.modelName})`,
            newText: `serialiserFactory.create(${alias.descriptorName}.model)`,
          });
        }

        // Pattern: modelRegistry.register(AliasModel) -> modelRegistry.register(AliasDescriptor.model)
        if (line.includes(`modelRegistry.register(${alias.modelName})`)) {
          usages.push({
            line: lineNumber,
            oldText: `modelRegistry.register(${alias.modelName})`,
            newText: `modelRegistry.register(${alias.descriptorName}.model)`,
          });
        }

        // Pattern: AliasModel.property -> AliasDescriptor.model.property
        const aliasPropertyPattern = new RegExp(`${alias.modelName}\\.(\\w+)`, "g");
        let match;
        while ((match = aliasPropertyPattern.exec(line)) !== null) {
          usages.push({
            line: lineNumber,
            oldText: `${alias.modelName}.${match[1]}`,
            newText: `${alias.descriptorName}.model.${match[1]}`,
          });
        }

        // Pattern: standalone AliasModel usage (not followed by .)
        if (!line.includes(`${alias.modelName}.`)) {
          const standaloneAliasPattern = new RegExp(`\\b${alias.modelName}\\b`, "g");
          if (standaloneAliasPattern.test(line)) {
            usages.push({
              line: lineNumber,
              oldText: alias.modelName,
              newText: `${alias.descriptorName}.model`,
            });
          }
        }
      }
    }
  }

  // Deduplicate usages for the same line and text
  return deduplicateUsages(usages);
}

/**
 * Extracts ALL old import statements related to the entity.
 * Note: Excludes imports from .meta.ts files since those are preserved.
 */
function extractAllOldImports(
  content: string,
  entityName: string,
  metaName: string,
  modelName: string,
  entityTypeName: string,
  aliasModels: AliasModelInfo[] = [],
): string[] {
  const imports: string[] = [];
  const lines = content.split("\n");

  // Build list of all model names (base + aliases) for pattern matching
  const allModelNames = [modelName, ...aliasModels.map((a) => a.modelName)];

  for (const line of lines) {
    if (!line.trim().startsWith("import ")) continue;

    // Skip imports from .meta.ts files - those are preserved and still valid
    if (line.includes(`${entityName}.meta"`)) continue;

    // Check for various import patterns (entity/model files that will be deleted)
    const isEntityImport =
      allModelNames.some((name) => line.includes(name)) ||
      (line.includes(`${entityName}.entity`) && line.includes(entityTypeName)) ||
      line.includes(`${entityName}.model`);

    if (isEntityImport) {
      imports.push(line);
    }
  }

  return imports;
}

/**
 * Calculates the new import statement, consolidating all old imports.
 */
function calculateNewImport(
  oldImports: string[],
  entityName: string,
  labelName: string,
  aliasModels: AliasModelInfo[] = [],
  fileContent: string = "",
): string {
  const descriptorName = `${labelName}Descriptor`;
  const imports: string[] = [];
  let importPath: string | null = null;

  // Determine what to import
  let needsDescriptor = false;
  let needsEntityType = false;
  const neededAliasDescriptors = new Set<string>();

  for (const oldImport of oldImports) {
    // Check what's being imported
    if (oldImport.includes("Meta") || oldImport.includes(`${labelName}Model`)) {
      needsDescriptor = true;
    }

    // Check for alias models
    for (const alias of aliasModels) {
      if (oldImport.includes(alias.modelName)) {
        neededAliasDescriptors.add(alias.descriptorName);
      }
    }

    // Check if the entity type itself is imported
    const entityTypePattern = new RegExp(`\\b${labelName}\\b`);
    if (entityTypePattern.test(oldImport) && !oldImport.includes("Model") && !oldImport.includes("Meta")) {
      needsEntityType = true;
    }

    // Extract path for the new import
    const pathMatch = oldImport.match(/from\s+["']([^"']+)["']/);
    if (pathMatch && !importPath) {
      let extractedPath = pathMatch[1];
      // Remove suffixes to get base path
      extractedPath = extractedPath.replace(/\.(meta|model|entity)$/, "");
      importPath = extractedPath;
    }
  }

  // Also check if the entity type is used in the file content (e.g., in return types like Promise<User[]>)
  // This catches cases where the type is used but wasn't in the old imports
  if (!needsEntityType && fileContent) {
    // Look for entity type usage outside of import lines
    const lines = fileContent.split("\n").filter((line) => !line.trim().startsWith("import "));
    const contentWithoutImports = lines.join("\n");
    // Match the entity type followed by common type patterns: [], >, ), :, |, &, etc.
    const typeUsagePattern = new RegExp(`\\b${labelName}\\s*[\\[\\]>\\):\\|&,]`, "g");
    if (typeUsagePattern.test(contentWithoutImports)) {
      needsEntityType = true;
    }
  }

  if (!importPath) {
    // Fallback: construct path from entity name
    importPath = `src/features/${entityName}/entities/${entityName}`;
  }

  // Build import list
  if (needsDescriptor) {
    imports.push(descriptorName);
  }
  if (needsEntityType) {
    imports.push(labelName);
  }
  // Add alias descriptors
  for (const aliasDescriptor of neededAliasDescriptors) {
    imports.push(aliasDescriptor);
  }

  if (imports.length === 0) {
    imports.push(descriptorName); // Default to descriptor
  }

  return `import { ${imports.join(", ")} } from "${importPath}";`;
}

/**
 * Updates a file with the new references.
 */
export function updateFileReferences(filePath: string, reference: Reference): string {
  let content = fs.readFileSync(filePath, "utf-8");
  const lines = content.split("\n");
  const newLines: string[] = [];

  // Track which old imports we need to remove
  const oldImportLines = new Set(reference.oldImport.split("\n"));
  let newImportAdded = false;

  // First pass: handle imports
  for (const line of lines) {
    if (oldImportLines.has(line)) {
      // Replace first old import with new import, skip rest
      if (!newImportAdded) {
        newLines.push(reference.newImport);
        newImportAdded = true;
      }
      // Skip this old import line
    } else {
      newLines.push(line);
    }
  }

  content = newLines.join("\n");

  // Second pass: apply usage replacements (only to non-import lines)
  // Sort by length descending to replace longer patterns first
  const sortedUsages = [...reference.usages].sort((a, b) => b.oldText.length - a.oldText.length);

  for (const usage of sortedUsages) {
    // Use a regex that doesn't match inside import statements
    const lines2 = content.split("\n");
    const updatedLines: string[] = [];

    for (const line of lines2) {
      if (line.trim().startsWith("import ")) {
        // Don't modify import lines
        updatedLines.push(line);
      } else {
        // Replace in non-import lines
        updatedLines.push(line.split(usage.oldText).join(usage.newText));
      }
    }

    content = updatedLines.join("\n");
  }

  return content;
}

/**
 * Deduplicates usages that have the same oldText.
 */
function deduplicateUsages(usages: ReferenceUsage[]): ReferenceUsage[] {
  const seen = new Set<string>();
  return usages.filter((usage) => {
    // Dedupe by oldText only (not line) to avoid multiple replacements
    if (seen.has(usage.oldText)) return false;
    seen.add(usage.oldText);
    return true;
  });
}

/**
 * Generates a summary of all reference changes.
 */
export function summarizeReferences(references: Reference[]): string {
  if (references.length === 0) {
    return "No external references found.";
  }

  let summary = `Found ${references.length} files with references:\n`;
  for (const ref of references) {
    const relativePath = path.relative(process.cwd(), ref.filePath);
    summary += `  - ${relativePath} (${ref.usages.length} changes)\n`;
  }

  return summary;
}
