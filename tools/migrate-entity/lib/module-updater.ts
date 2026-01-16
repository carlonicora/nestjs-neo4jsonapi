/**
 * Entity Migration CLI - Module Updater
 *
 * Updates the entity's module file to use the new descriptor pattern.
 */

import * as fs from "fs";
import * as path from "path";
import { glob } from "glob";
import { AliasModelInfo } from "./types";

export interface ModuleUpdateResult {
  modulePath: string;
  changes: string[];
  updatedContent: string;
}

/**
 * Finds the module file for an entity.
 */
export async function findModuleFile(modulePath: string): Promise<string | null> {
  const pattern = path.join(modulePath, "*.module.ts");
  const files = await glob(pattern, { nodir: true });
  return files.length > 0 ? files[0] : null;
}

/**
 * Updates the module file to use the new descriptor pattern.
 */
export function updateModule(
  modulePath: string,
  entityName: string,
  labelName: string,
  aliasModels: AliasModelInfo[] = []
): ModuleUpdateResult | null {
  const content = fs.readFileSync(modulePath, "utf-8");
  const changes: string[] = [];

  const descriptorName = `${labelName}Descriptor`;
  const modelName = `${labelName}Model`;
  const serialiserName = `${labelName}Serialiser`;

  // Build list of all descriptors (base + aliases)
  const allDescriptors = [descriptorName, ...aliasModels.map(a => a.descriptorName)];

  let updatedContent = content;

  // 1. Update import: EntityModel, AliasModel... -> EntityDescriptor, AliasDescriptor...
  // Handle imports that may include multiple models on one line
  const modelImportPattern = new RegExp(
    `import\\s*\\{[^}]*${modelName}[^}]*\\}\\s*from\\s*["'][^"']+\\.model["'];?`,
    "g"
  );
  if (modelImportPattern.test(updatedContent)) {
    // Replace the entire import with the new descriptors
    const newImportPath = `import { ${allDescriptors.join(", ")} } from "./entities/${entityName}";`;
    updatedContent = updatedContent.replace(modelImportPattern, newImportPath);
    changes.push(`Updated import: models -> ${allDescriptors.join(", ")}`);
  }

  // 2. Remove serialiser import (it's now auto-generated)
  const serialiserImportPattern = new RegExp(
    `import\\s*\\{\\s*${serialiserName}\\s*\\}\\s*from\\s*["'][^"']+["'];?\\n?`,
    "g"
  );
  if (serialiserImportPattern.test(updatedContent)) {
    updatedContent = updatedContent.replace(serialiserImportPattern, "");
    changes.push(`Removed import: ${serialiserName} (now auto-generated)`);
  }

  // 3. Update providers: EntitySerialiser -> EntityDescriptor.model.serialiser
  const serialiserProviderPattern = new RegExp(`\\b${serialiserName}\\b(?!\\.)`, "g");
  if (serialiserProviderPattern.test(updatedContent)) {
    updatedContent = updatedContent.replace(serialiserProviderPattern, `${descriptorName}.model.serialiser`);
    changes.push(`Updated provider: ${serialiserName} -> ${descriptorName}.model.serialiser`);
  }

  // 4. Update modelRegistry.register(EntityModel) -> modelRegistry.register(EntityDescriptor.model)
  const registryPattern = new RegExp(`modelRegistry\\.register\\(${modelName}\\)`, "g");
  if (registryPattern.test(updatedContent)) {
    updatedContent = updatedContent.replace(registryPattern, `modelRegistry.register(${descriptorName}.model)`);
    changes.push(`Updated registry: modelRegistry.register(${modelName}) -> modelRegistry.register(${descriptorName}.model)`);
  }

  // 4b. Update alias model registry registrations
  for (const alias of aliasModels) {
    const aliasRegistryPattern = new RegExp(`modelRegistry\\.register\\(${alias.modelName}\\)`, "g");
    if (aliasRegistryPattern.test(updatedContent)) {
      updatedContent = updatedContent.replace(
        aliasRegistryPattern,
        `modelRegistry.register(${alias.descriptorName}.model)`
      );
      changes.push(`Updated registry: modelRegistry.register(${alias.modelName}) -> modelRegistry.register(${alias.descriptorName}.model)`);
    }
  }

  // 5. Update any other standalone EntityModel usages
  const standaloneModelPattern = new RegExp(`\\b${modelName}\\b(?!\\.)`, "g");
  if (standaloneModelPattern.test(updatedContent)) {
    updatedContent = updatedContent.replace(standaloneModelPattern, `${descriptorName}.model`);
    changes.push(`Updated standalone ${modelName} usages`);
  }

  // 5b. Update any other standalone alias model usages
  for (const alias of aliasModels) {
    const standaloneAliasPattern = new RegExp(`\\b${alias.modelName}\\b(?!\\.)`, "g");
    if (standaloneAliasPattern.test(updatedContent)) {
      updatedContent = updatedContent.replace(standaloneAliasPattern, `${alias.descriptorName}.model`);
      changes.push(`Updated standalone ${alias.modelName} usages`);
    }
  }

  if (changes.length === 0) {
    return null;
  }

  return {
    modulePath,
    changes,
    updatedContent,
  };
}

/**
 * Generates the updated module content with proper formatting.
 */
export function formatModuleContent(content: string): string {
  // Remove duplicate empty lines
  let formatted = content.replace(/\n{3,}/g, "\n\n");

  // Ensure single newline at end of file
  formatted = formatted.trimEnd() + "\n";

  return formatted;
}

/**
 * Finds all files in the module that need updating.
 * This includes controllers, services, repositories, etc.
 */
export async function findModuleFiles(modulePath: string): Promise<string[]> {
  const pattern = path.join(modulePath, "**/*.ts");
  const files = await glob(pattern, { nodir: true });

  // Exclude node_modules, dist, and test files
  return files.filter((f) => {
    return !f.includes("node_modules") && !f.includes("/dist/") && !f.endsWith(".spec.ts");
  });
}
