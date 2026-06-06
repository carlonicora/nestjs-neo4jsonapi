/**
 * Prune a generated DTO file's `class-validator` import to exactly the
 * decorators it actually uses.
 *
 * The validator import list is assembled from a fixed base set plus field-type
 * inferences, which can over-include (e.g. `IsOptional` when every field and
 * relationship is required, or `IsDefined` when everything is optional). An
 * unused import is an ESLint `no-unused-vars` error, so we filter the list down
 * to the names that appear as a `@Name(` decorator in the rest of the file.
 *
 * @param content - The full generated DTO file content.
 * @returns The content with its class-validator import line pruned.
 */
export function pruneClassValidatorImports(content: string): string {
  const importRe = /import \{ ([^}]+) \} from "class-validator";/;
  const match = content.match(importRe);
  if (!match) return content;

  const names = match[1]
    .split(",")
    .map((n) => n.trim())
    .filter(Boolean);

  // Everything except the import line itself — a name appearing only in the
  // import must not count as "used".
  const body = content.replace(importRe, "");
  const used = names.filter((name) => new RegExp(`@${name}\\(`).test(body));

  // class-validator decorators are always used somewhere (Equals/IsUUID at minimum),
  // but guard against an empty list just in case.
  if (used.length === 0) return content;

  return content.replace(importRe, `import { ${used.join(", ")} } from "class-validator";`);
}
