import { createHash } from "node:crypto";
import { readFile, writeFile, readdir } from "node:fs/promises";
import { execSync } from "node:child_process";
import { join, relative, sep } from "node:path";
import matter from "gray-matter";
import { unified } from "unified";
import remarkParse from "remark-parse";
import remarkMdx from "remark-mdx";
import type { Root, Heading } from "mdast";
import { helpFrontmatterSchema } from "../../foundations/help-content-sync/schema/frontmatter.schema";
import { HELP_MODES, HelpMode } from "../../foundations/help-content-sync/interfaces/help-article.interface";
// NOTE: buildManifest produces ids using the consumer-provided namespaceUuid.
// The build script accepts namespaceUuid as a parameter so the manifest's ids
// match what the runtime sync will compute via toContentId.
import { toContentId } from "../../foundations/help-content-sync/helpers/to-content-id";

export interface BuildManifestOptions {
  srcDir: string;
  outputPath: string;
  namespaceUuid: string;
  includeDrafts?: boolean;
}

interface BuiltEntry {
  id: string;
  slug: string;
  mode: HelpMode;
  title: string;
  summary: string;
  order: number;
  tags: string[];
  contextualKeys: string[];
  aiIndexed: boolean;
  draft: boolean;
  contentHash: string;
  path: string;
  headings: { depth: 2 | 3; slug: string; text: string }[];
  relatedSlugs: string[];
  lastUpdated: string;
}

function slugifyHeading(text: string): string {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "");
}

function extractHeadings(tree: Root): { depth: 2 | 3; slug: string; text: string }[] {
  const out: { depth: 2 | 3; slug: string; text: string }[] = [];
  function walk(node: unknown) {
    const n = node as { type?: string; depth?: number; children?: unknown[]; value?: string };
    if (n.type === "heading" && (n.depth === 2 || n.depth === 3)) {
      const heading = node as Heading;
      const text = heading.children
        .map((c: unknown) => {
          const child = c as { value?: string };
          return typeof child.value === "string" ? child.value : "";
        })
        .join("")
        .trim();
      out.push({ depth: n.depth as 2 | 3, slug: slugifyHeading(text), text });
    }
    if (n.children && Array.isArray(n.children)) n.children.forEach(walk);
  }
  walk(tree);
  return out;
}

function lastUpdatedFromGit(absPath: string): string {
  try {
    const iso = execSync(`git log -1 --format=%cI -- "${absPath}"`, { encoding: "utf8" }).trim();
    if (iso) return iso;
  } catch {
    // file not tracked yet
  }
  return new Date().toISOString();
}

async function walkMdxFiles(dir: string): Promise<string[]> {
  const entries = await readdir(dir, { withFileTypes: true });
  const out: string[] = [];
  for (const entry of entries) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) out.push(...(await walkMdxFiles(full)));
    else if (entry.isFile() && entry.name.endsWith(".mdx")) out.push(full);
  }
  return out;
}

export async function buildManifest(opts: BuildManifestOptions): Promise<BuiltEntry[]> {
  const { srcDir, outputPath, namespaceUuid, includeDrafts = false } = opts;
  const mdxFiles = await walkMdxFiles(srcDir);
  const entries: BuiltEntry[] = [];
  const seenBySlug = new Map<string, string>();

  for (const abs of mdxFiles) {
    const rel = relative(srcDir, abs).split(sep).join("/");
    const parts = rel.split("/");
    if (parts.length !== 2) continue;
    const [modeFolder, fileName] = parts;
    if (!(HELP_MODES as readonly string[]).includes(modeFolder)) continue;
    if (!fileName.endsWith(".mdx")) continue;
    const slug = fileName.replace(/\.mdx$/, "");
    const dedupKey = `${modeFolder}/${slug.toLowerCase()}`;
    if (seenBySlug.has(dedupKey)) {
      throw new Error(`Duplicate slug detected: ${rel} conflicts with ${seenBySlug.get(dedupKey)}`);
    }
    seenBySlug.set(dedupKey, rel);

    const raw = await readFile(abs, "utf8");
    const fm = matter(raw);
    const parsed = helpFrontmatterSchema.parse(fm.data);
    if (!includeDrafts && parsed.draft) continue;

    const tree = unified().use(remarkParse).use(remarkMdx).parse(fm.content) as Root;
    const headings = extractHeadings(tree);
    const contentHash = createHash("sha256").update(raw).digest("hex");

    entries.push({
      id: toContentId(modeFolder as HelpMode, slug, namespaceUuid),
      slug,
      mode: modeFolder as HelpMode,
      title: parsed.title,
      summary: parsed.summary,
      order: parsed.order,
      tags: parsed.tags,
      contextualKeys: parsed.contextual_keys,
      aiIndexed: parsed.ai_indexed,
      draft: parsed.draft,
      contentHash,
      path: rel,
      headings,
      relatedSlugs: parsed.related,
      lastUpdated: lastUpdatedFromGit(abs),
    });
  }

  const visibleSet = new Set(entries.map((e) => `${e.mode}/${e.slug}`));
  for (const e of entries) {
    for (const relSlug of e.relatedSlugs) {
      if (!visibleSet.has(relSlug)) {
        throw new Error(`Article ${e.mode}/${e.slug} relates to non-existent ${relSlug}`);
      }
    }
  }

  entries.sort((a, b) => a.mode.localeCompare(b.mode) || a.order - b.order);

  const file = `// AUTO-GENERATED by @carlonicora/nestjs-neo4jsonapi/help-content-build. Do not edit by hand.
import type { HelpArticle } from "@carlonicora/nestjs-neo4jsonapi";
export const helpManifest: readonly HelpArticle[] = ${JSON.stringify(entries, null, 2)} as const;
`;
  await writeFile(outputPath, file, "utf8");
  return entries;
}
