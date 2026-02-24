import { TemplateData } from "../types/template-data.interface";

/**
 * Generate meta file content
 *
 * Meta files contain lightweight metadata (type, endpoint, nodeName, labelName)
 * that can be imported without causing circular dependencies.
 *
 * When aliased relationships exist (e.g., CreatedBy and AssignedTo both targeting User),
 * alias-specific DataMeta constants are generated for route disambiguation.
 *
 * @param data - Template data
 * @returns Generated TypeScript code for meta file
 */
export function generateMetaFile(data: TemplateData): string {
  const { names, endpoint, nodeName, labelName, aliasMetas } = data;

  // Collect unique base entity meta imports needed for alias metas
  const aliasImports = new Map<string, Set<string>>();
  for (const alias of aliasMetas) {
    if (!aliasImports.has(alias.baseEntityImportPath)) {
      aliasImports.set(alias.baseEntityImportPath, new Set());
    }
    aliasImports.get(alias.baseEntityImportPath)!.add(alias.baseEntityMeta);
  }

  // Build import lines
  const importLines: string[] = [`import { DataMeta } from "@carlonicora/nestjs-neo4jsonapi";`];
  for (const [importPath, metaNames] of aliasImports.entries()) {
    // Avoid duplicating the library import if base entity meta is also from the library
    if (importPath === "@carlonicora/nestjs-neo4jsonapi") {
      // Merge with existing library import
      importLines[0] = `import { DataMeta, ${Array.from(metaNames).sort().join(", ")} } from "@carlonicora/nestjs-neo4jsonapi";`;
    } else {
      importLines.push(`import { ${Array.from(metaNames).sort().join(", ")} } from "${importPath}";`);
    }
  }

  // Build alias meta constants
  const aliasMetaConstants = aliasMetas
    .map(
      (alias) =>
        `export const ${alias.aliasCamelCase}Meta: DataMeta = { ...${alias.baseEntityMeta}, endpoint: "${alias.aliasKebabCase}", nodeName: "${alias.aliasCamelCase}" };`
    )
    .join("\n");

  const aliasSection = aliasMetaConstants ? `\n${aliasMetaConstants}\n` : "";

  return `${importLines.join("\n")}

export const ${names.camelCase}Meta: DataMeta = {
  type: "${endpoint}",
  endpoint: "${endpoint}",
  nodeName: "${nodeName}",
  labelName: "${labelName}",
};
${aliasSection}`;
}
