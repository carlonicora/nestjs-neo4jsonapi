import * as fs from "fs";
import * as path from "path";

/**
 * Update features.modules.ts to register the new module
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

  // Determine the parent module file based on targetDir
  let parentModulePath: string;
  if (targetDir === "features") {
    parentModulePath = path.resolve(process.cwd(), "apps/api/src/features/features.modules.ts");
  } else if (targetDir === "foundations") {
    parentModulePath = path.resolve(process.cwd(), "apps/api/src/foundations/foundations.modules.ts");
  } else {
    throw new Error(`Unknown target directory: ${targetDir}`);
  }

  // Check if parent module file exists
  if (!fs.existsSync(parentModulePath)) {
    console.warn(`⚠️  Warning: Parent module file not found: ${parentModulePath}`);
    console.warn(`   You will need to manually register ${moduleName}Module`);
    return;
  }

  let content = fs.readFileSync(parentModulePath, "utf-8");

  // Build import statement
  const moduleClassName = `${moduleName}Module`;
  const importPath = `src/${targetDir}/${kebabName}/${kebabName}.module`;
  const newImport = `import { ${moduleClassName} } from "${importPath}";\n`;

  // Check if already imported
  if (content.includes(`import { ${moduleClassName} }`)) {
    console.log(`ℹ️  ${moduleClassName} is already imported in ${parentModulePath}`);
    return;
  }

  if (dryRun) {
    console.log(`[DRY RUN] Would add import to ${parentModulePath}:`);
    console.log(`  ${newImport.trim()}`);
    console.log(`[DRY RUN] Would add ${moduleClassName} to imports array`);
    return;
  }

  // Find the last import statement
  const importRegex = /import\s+{[^}]+}\s+from\s+"[^"]+";?\n/g;
  const imports = [...content.matchAll(importRegex)];

  if (imports.length === 0) {
    throw new Error("Could not find any import statements in parent module file");
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
  const moduleImportsRegex = /imports:\s*\[([\s\S]*?)\]/;
  const match = content.match(moduleImportsRegex);

  if (!match) {
    throw new Error("Could not find @Module imports array");
  }

  // Parse existing modules
  const importsArrayContent = match[1];
  const modules = importsArrayContent
    .split(",")
    .map((m) => m.trim())
    .filter((m) => m);

  // Add new module alphabetically
  modules.push(moduleClassName);
  modules.sort();

  // Rebuild imports array with proper formatting
  const newImportsArray = `imports: [\n    ${modules.join(",\n    ")},\n  ]`;
  content = content.replace(moduleImportsRegex, newImportsArray);

  // Write back
  fs.writeFileSync(parentModulePath, content, "utf-8");
  console.log(`✓ Registered ${moduleClassName} in ${parentModulePath}`);
}
