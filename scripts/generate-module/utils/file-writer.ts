import * as fs from "fs";
import * as path from "path";

export interface FileToWrite {
  path: string;
  content: string;
}

/**
 * Check if files exist (for conflict detection)
 *
 * @param files - List of files to check
 * @returns Array of existing file paths
 */
export function checkFileConflicts(files: FileToWrite[]): string[] {
  return files.filter((file) => fs.existsSync(file.path)).map((file) => file.path);
}

/**
 * Write files to disk
 *
 * @param files - Files to write
 * @param options - Write options
 */
export function writeFiles(
  files: FileToWrite[],
  options: {
    dryRun?: boolean;
    force?: boolean;
  } = {}
): void {
  const { dryRun = false, force = false } = options;

  if (!force) {
    const conflicts = checkFileConflicts(files);
    if (conflicts.length > 0) {
      throw new Error(
        `Files already exist. Use --force to overwrite:\n${conflicts.map((f) => `  - ${f}`).join("\n")}`
      );
    }
  }

  for (const file of files) {
    if (dryRun) {
      console.log(`[DRY RUN] Would create: ${file.path}`);
      continue;
    }

    // Create directory if it doesn't exist
    const dir = path.dirname(file.path);
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }

    // Write file
    fs.writeFileSync(file.path, file.content, "utf-8");
    console.log(`✓ Created: ${file.path}`);
  }
}

/**
 * Build absolute file path
 *
 * @param relativePath - Relative path from project root
 * @returns Absolute path
 */
export function buildFilePath(relativePath: string): string {
  // Assuming the script is run from the project root
  return path.resolve(process.cwd(), relativePath);
}
