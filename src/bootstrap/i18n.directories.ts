import * as fs from "fs";
import { I18nJsonLoader, I18nLoader } from "nestjs-i18n";
import * as path from "path";

const directories: string[] = [];
let consumed = false;

/**
 * Registers an extra folder of API translations, so a package can ship its own
 * texts next to the app's.
 *
 * The folder holds `<locale>/<namespace>.json`. Keys are merged with the app's:
 * the app's keys win over every package, and the first registered package wins
 * over a later one.
 *
 * Must run before the app is built: call it synchronously inside a module's
 * static `forRoot` that the app imports before `bootstrap()` runs. A call after
 * the i18n module was built throws, since its texts would otherwise be missing.
 *
 * @param directory - absolute path of an existing folder
 * @throws when the path is relative, the folder does not exist, or the i18n module was already built
 */
export function registerI18nDirectory(directory: string): void {
  if (!path.isAbsolute(directory)) {
    throw new Error(`registerI18nDirectory needs an absolute path, got "${directory}"`);
  }
  const resolved = path.resolve(directory);
  if (!fs.existsSync(resolved)) {
    throw new Error(`registerI18nDirectory: folder "${directory}" does not exist`);
  }
  if (consumed) {
    throw new Error(
      `registerI18nDirectory("${directory}") ran after the i18n module was built. Call it inside a module's static forRoot that the app imports before bootstrap() runs.`,
    );
  }
  if (directories.includes(resolved)) return;
  directories.push(resolved);
}

/** The registered i18n folders, in registration order. */
export function getRegisteredI18nDirectories(): readonly string[] {
  return [...directories];
}

/**
 * The loaders handed to nestjs-i18n: registered folders in reverse registration
 * order, then the app's folder. nestjs-i18n merges later loaders over earlier
 * ones, so the app wins and the first registered package beats later ones.
 * Marks the registry consumed: later registrations throw.
 */
export function buildI18nLoaders(params: { appPath: string; watch: boolean }): I18nLoader[] {
  consumed = true;
  return [
    ...[...directories].reverse().map((dir) => new I18nJsonLoader({ path: dir, watch: false })),
    new I18nJsonLoader({ path: params.appPath, watch: params.watch }),
  ];
}

/** Specs only: forgets every registered folder and clears the consumed mark. */
export function clearRegisteredI18nDirectories(): void {
  directories.length = 0;
  consumed = false;
}
