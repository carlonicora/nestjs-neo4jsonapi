import * as fs from "fs";
import * as path from "path";

const directories: string[] = [];

/**
 * Registers an extra folder of email templates, so a package can ship its own
 * templates next to the app's and the library's.
 *
 * The folder holds `<locale>/<template>.hbs`. `EmailService` looks a template up
 * in this order, the first file that exists wins:
 * app `<locale>`, app `<defaultLocale>`; then, for each registered folder in
 * registration order, `<locale>`, `<defaultLocale>`; then library `<locale>`,
 * library `en`.
 *
 * The `header`, `footer` and `unsubscribe` partials always come from the app's
 * folder; a registered folder is never searched for them.
 *
 * Meant to be called from a package module's static `forRoot`. The registry is
 * read on every send, so any registration made before a send is used.
 *
 * @param directory - absolute path of an existing folder
 * @throws when the path is relative or the folder does not exist
 */
export function registerEmailTemplateDirectory(directory: string): void {
  if (!path.isAbsolute(directory)) {
    throw new Error(`registerEmailTemplateDirectory needs an absolute path, got "${directory}"`);
  }
  const resolved = path.resolve(directory);
  if (!fs.existsSync(resolved)) {
    throw new Error(`registerEmailTemplateDirectory: folder "${directory}" does not exist`);
  }
  if (directories.includes(resolved)) return;
  directories.push(resolved);
}

/** The registered email-template folders, in registration order. */
export function getRegisteredEmailTemplateDirectories(): readonly string[] {
  return [...directories];
}

/** Specs only: forgets every registered folder. */
export function clearRegisteredEmailTemplateDirectories(): void {
  directories.length = 0;
}
