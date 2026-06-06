import * as fs from "fs";
import * as path from "path";

/**
 * Register an import and add to @Module imports array in a module file
 */
function addToModuleFile(params: {
  moduleFilePath: string;
  moduleClassName: string;
  importPath: string;
  dryRun: boolean;
}): void {
  const { moduleFilePath, moduleClassName, importPath, dryRun } = params;

  const fullPath = path.resolve(process.cwd(), moduleFilePath);

  // Check if module file exists
  if (!fs.existsSync(fullPath)) {
    console.warn(`⚠️  Warning: Module file not found: ${fullPath}`);
    console.warn(`   You will need to manually register ${moduleClassName}`);
    return;
  }

  let content = fs.readFileSync(fullPath, "utf-8");

  // Build import statement
  const newImport = `import { ${moduleClassName} } from "${importPath}";\n`;

  // Check if already imported
  if (content.includes(`import { ${moduleClassName} }`)) {
    console.info(`ℹ️  ${moduleClassName} is already imported in ${fullPath}`);
    return;
  }

  if (dryRun) {
    console.info(`[DRY RUN] Would add import to ${fullPath}:`);
    console.info(`  ${newImport.trim()}`);
    console.info(`[DRY RUN] Would add ${moduleClassName} to imports array`);
    return;
  }

  // Find the last import statement
  const importRegex = /import\s+{[^}]+}\s+from\s+"[^"]+";?\n/g;
  const imports = [...content.matchAll(importRegex)];

  if (imports.length === 0) {
    throw new Error(`Could not find any import statements in ${fullPath}`);
  }

  const lastImport = imports[imports.length - 1];
  const lastImportEnd = lastImport.index! + lastImport[0].length;

  // Insert new import alphabetically
  let insertPosition = lastImportEnd;
  for (const imp of imports) {
    const impText = imp[0];
    if (impText > newImport) {
      insertPosition = imp.index!;
      break;
    }
  }

  content = content.slice(0, insertPosition) + newImport + content.slice(insertPosition);

  // Find the @Module imports array
  // Insert the new module as the first entry in the @Module imports array.
  // We deliberately do NOT split/re-sort the existing entries: an entry such as
  // `RbacModule.register({ moduleUserPaths, rbac, devMode })` contains commas and
  // would be shredded by a naive `split(",")`. Prepending after the opening `[`
  // is comma-safe; Prettier (run afterwards) normalises the formatting.
  const importsArrayOpenRegex = /imports:\s*\[/;
  if (!importsArrayOpenRegex.test(content)) {
    throw new Error(`Could not find @Module imports array in ${fullPath}`);
  }

  content = content.replace(importsArrayOpenRegex, (open) => `${open}\n    ${moduleClassName},`);

  // Write back
  fs.writeFileSync(fullPath, content, "utf-8");
  console.info(`✓ Registered ${moduleClassName} in ${fullPath}`);
}

/**
 * Register the new module in the base aggregator module file.
 *
 * The leaf `<Module>Module` is added directly to `features.modules.ts`
 * (or `foundations.modules.ts`) regardless of how deep `targetDir` is. The repo
 * lists leaf feature modules there directly; creating per-domain sub-aggregators
 * produced orphan `*.modules.ts` files and double-registration.
 *
 * @param params - Module information
 */
export function registerModule(params: {
  moduleName: string;
  targetDir: string;
  kebabName: string;
  dryRun?: boolean;
}): void {
  const { moduleName, targetDir, kebabName, dryRun = false } = params;

  const baseDir = targetDir.split("/")[0]; // "features" or "foundations"

  if (!["features", "foundations"].includes(baseDir)) {
    throw new Error(`Unknown target directory: ${targetDir}. Must start with "features" or "foundations"`);
  }

  addToModuleFile({
    moduleFilePath: `apps/api/src/${baseDir}/${baseDir}.modules.ts`,
    moduleClassName: `${moduleName}Module`,
    importPath: `src/${targetDir}/${kebabName}/${kebabName}.module`,
    dryRun,
  });
}
