import * as fs from "fs";
import * as path from "path";

/**
 * Convert kebab-case to PascalCase
 */
function toPascalCase(str: string): string {
  return str
    .split("-")
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
    .join("");
}

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
  const moduleImportsRegex = /imports:\s*\[([\s\S]*?)\]/;
  const match = content.match(moduleImportsRegex);

  if (!match) {
    throw new Error(`Could not find @Module imports array in ${fullPath}`);
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
  fs.writeFileSync(fullPath, content, "utf-8");
  console.info(`✓ Registered ${moduleClassName} in ${fullPath}`);
}

/**
 * Create a new subfolder modules file
 */
function createSubfolderModulesFile(params: {
  subfolderName: string;
  targetDir: string;
  dryRun: boolean;
}): void {
  const { subfolderName, targetDir, dryRun } = params;
  const pascalName = toPascalCase(subfolderName);

  const content = `import { Module } from "@nestjs/common";

@Module({
  imports: [],
})
export class ${pascalName}Modules {}
`;

  const filePath = path.resolve(process.cwd(), `apps/api/src/${targetDir}/${subfolderName}.modules.ts`);

  if (dryRun) {
    console.info(`[DRY RUN] Would create ${filePath}`);
    return;
  }

  // Ensure the directory exists
  const dir = path.dirname(filePath);
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }

  fs.writeFileSync(filePath, content, "utf-8");
  console.info(`✓ Created ${filePath}`);
}

/**
 * Update parent modules.ts to register the new module
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

  const segments = targetDir.split("/");
  const baseDir = segments[0]; // "features" or "foundations"

  if (!["features", "foundations"].includes(baseDir)) {
    throw new Error(`Unknown target directory: ${targetDir}. Must start with "features" or "foundations"`);
  }

  const moduleClassName = `${moduleName}Module`;
  const importPath = `src/${targetDir}/${kebabName}/${kebabName}.module`;

  if (segments.length === 1) {
    // Simple case: "features" or "foundations" → register in top-level
    addToModuleFile({
      moduleFilePath: `apps/api/src/${baseDir}/${baseDir}.modules.ts`,
      moduleClassName,
      importPath,
      dryRun,
    });
  } else {
    // Subdirectory case: "features/customer-management" → register in subfolder
    const subfolderName = segments[1]; // e.g., "customer-management"
    const subfolderModulePath = `apps/api/src/${targetDir}/${subfolderName}.modules.ts`;
    const fullSubfolderPath = path.resolve(process.cwd(), subfolderModulePath);

    // Check if subfolder's .modules.ts exists
    if (!fs.existsSync(fullSubfolderPath)) {
      // Create the subfolder's .modules.ts file
      createSubfolderModulesFile({
        subfolderName,
        targetDir,
        dryRun,
      });

      // Register the new subfolder modules in the parent
      const parentModulePath = `apps/api/src/${baseDir}/${baseDir}.modules.ts`;
      const pascalSubfolderName = toPascalCase(subfolderName);
      addToModuleFile({
        moduleFilePath: parentModulePath,
        moduleClassName: `${pascalSubfolderName}Modules`,
        importPath: `src/${targetDir}/${subfolderName}.modules`,
        dryRun,
      });
    }

    // Register the new module in the subfolder's .modules.ts
    addToModuleFile({
      moduleFilePath: subfolderModulePath,
      moduleClassName,
      importPath,
      dryRun,
    });
  }
}
