import { BadRequestException, Inject, Injectable } from "@nestjs/common";
import { createHash, randomUUID } from "crypto";
import { existsSync, readFileSync, readdirSync, statSync } from "fs";
import { join, relative, sep } from "path";
import { AppLoggingService } from "../../../core/logging/services/logging.service";
import { ModelService } from "../../../core/llm/services/model.service";
import { HandbookPage } from "../entities/handbook-page";
import { HANDBOOK_CONFIG, HandbookModuleConfig } from "../interfaces/handbook.config.interface";
import { HandbookPageRepository } from "../repositories/handbook-page.repository";
import { HandbookSectionRepository } from "../repositories/handbook-section.repository";
import { HandbookPageService } from "./handbook-page.service";

export type HandbookSyncResult = {
  created: number;
  updated: number;
  unchanged: number;
  deleted: number;
  /** Repo-relative paths whose ingest threw. The walk continues past them. */
  failed: string[];
};

/**
 * Bumped whenever the walk changes how a file becomes a page — frontmatter
 * handling, title derivation, what is stripped before chunking.
 *
 * It is mixed into `contentHash`, so a parsing change invalidates every stored
 * page and the next sync re-ingests them. Without it the hash only tracks the
 * file's bytes: a fixed parser leaves every already-ingested page frozen in the
 * shape the old parser gave it, and the fix silently does nothing. That is
 * exactly what happened on the 2026-09-11 verification run.
 */
const INGEST_FORMAT_VERSION = "2";

type WalkedFile = {
  path: string;
  /** Frontmatter `section`, else the first path segment, else "" for a file at the tree root. */
  section: string;
  /** The repo-relative path, lowercased: sorting on it reproduces filesystem order. */
  order: string;
  /** The one-line description the tree's README index gives this path, when it has one. */
  summary?: string;
  content: string;
  title: string;
  hash: string;
  wordCount: number;
};

@Injectable()
export class HandbookIngestService {
  constructor(
    @Inject(HANDBOOK_CONFIG) private readonly config: Required<HandbookModuleConfig>,
    private readonly handbookPageRepository: HandbookPageRepository,
    private readonly handbookSectionRepository: HandbookSectionRepository,
    private readonly handbookPageService: HandbookPageService,
    private readonly modelService: ModelService,
    private readonly logger: AppLoggingService,
  ) {}

  async sync(): Promise<HandbookSyncResult> {
    // FIRST, before the directory is even read. Chunking is not work that
    // degrades gracefully without AI: every chunk is embedded as it is created
    // and every chunk queues an extraction call, so an unconfigured
    // installation would write a thousand nodes and queue a thousand jobs that
    // all fail inside provider construction. Nothing starts.
    if (!this.modelService.isAiConfigured()) {
      this.logger.warn("Handbook sync refused: no usable AI configuration (AI_PROVIDER / AI_MODEL / EMBEDDER_*).");
      throw new BadRequestException(
        "AI is not configured: set the AI_* and EMBEDDER_* variables (or an AI connection) before ingesting the handbook.",
      );
    }

    const root = this.config.path;

    if (!root)
      throw new BadRequestException(
        "No handbook directory configured. Set `handbook.path` on FoundationsModule.forRoot().",
      );

    if (!existsSync(root) || !statSync(root).isDirectory())
      throw new BadRequestException(`Configured handbook directory does not exist: ${root}`);

    // Read once, before the walk: the index is optional by construction, so an
    // application whose documentation tree has no README still ingests — it
    // just gets prettified section titles and pages with no summary.
    const index = this.readIndex(root);

    // The display translation, when the application ships one. It is a mirror
    // of the English tree under `<root>/<displayPath>` — the same relative
    // paths, translated prose — and it is SHOWN, never INDEXED: the English
    // walk skips it through `exclude`, and the pass at the foot of this method
    // writes its text onto pages the English walk already created. Its own
    // README is read here because the section write below needs it.
    const displayPath = this.config.displayPath ?? "";
    const displayRoot = displayPath.length > 0 ? join(root, displayPath) : "";
    const hasDisplay = displayRoot.length > 0 && existsSync(displayRoot) && statSync(displayRoot).isDirectory();
    const displayIndex = hasDisplay ? this.readIndex(displayRoot) : this.emptyIndex();

    const files = this.walk(root, index.summaries);
    const existing = await this.handbookPageRepository.findAllPages();
    const byPath = new Map<string, HandbookPage>(existing.map((page) => [page.path, page]));

    const result: HandbookSyncResult = { created: 0, updated: 0, unchanged: 0, deleted: 0, failed: [] };

    for (const file of files) {
      const page = byPath.get(file.path);
      try {
        if (!page) {
          const id = randomUUID();
          await this.handbookPageRepository.createPage({
            id,
            path: file.path,
            title: file.title,
            content: file.content,
            contentHash: file.hash,
            wordCount: file.wordCount,
            section: file.section,
            order: file.order,
            summary: file.summary,
          });
          await this.handbookPageService.chunkAndQueue({
            handbookPageId: id,
            markdown: file.content,
            title: file.title,
          });
          result.created++;
        } else if (page.contentHash === file.hash) {
          // The bytes did not change, so the chunks are still correct — but the
          // index fields may be new (a README summary added, a frontmatter
          // `section` corrected), and those cost nothing to rewrite.
          await this.handbookPageRepository.updateMetadata({
            id: page.id,
            title: file.title,
            section: file.section,
            order: file.order,
            summary: file.summary,
          });
          result.unchanged++;
        } else {
          await this.handbookPageRepository.updatePage({
            id: page.id,
            title: file.title,
            content: file.content,
            contentHash: file.hash,
            wordCount: file.wordCount,
            section: file.section,
            order: file.order,
            summary: file.summary,
          });
          await this.handbookPageService.chunkAndQueue({
            handbookPageId: page.id,
            markdown: file.content,
            title: file.title,
          });
          result.updated++;
        }
      } catch (error) {
        // One unreadable or unchunkable file must not abort the pass: the
        // remaining documentation is still worth indexing, and the caller gets
        // the list of what failed.
        this.logger.error(`Handbook ingest failed for ${file.path}: ${(error as Error).message}`);
        result.failed.push(file.path);
      }
    }

    const seen = new Set(files.map((file) => file.path));
    for (const page of existing) {
      if (seen.has(page.path)) continue;
      // Through the service, not the repository: it is what also drops the
      // page's chunks and resizes the key-concept weights they carried.
      await this.handbookPageService.delete({ id: page.id });
      result.deleted++;
    }

    // Sections come from the files, never from the index. A README's `##`
    // headings are prose sections as often as they are directories — a360's own
    // index carries `Reading orders`, `Conventions`, `Checking the handbook`,
    // `Adding a page`, `Where to look` and `Gaps and drift` — so accepting
    // arbitrary headings would print six empty junk sections on the contents
    // page. A section IS a directory of pages; the index only describes one,
    // contributing a title and a blurb to a key the walk already observed and
    // nothing at all to a key it did not.
    const keys = new Set<string>(files.map((file) => file.section));
    keys.delete("");

    await this.handbookSectionRepository.replaceAll({
      sections: [...keys].sort().map((key) => ({
        id: randomUUID(),
        key,
        title: index.sections.get(key)?.title ?? this.sectionTitle(key),
        summary: index.sections.get(key)?.summary,
        order: key,
        // The display README describes the same keys — it is a mirror — so a
        // heading it does not carry simply leaves the section untranslated and
        // the reading surface falls back to the English title.
        displayTitle: displayIndex.sections.get(key)?.title,
        displaySummary: displayIndex.sections.get(key)?.summary,
      })),
    });

    if (hasDisplay) await this.syncDisplay({ displayRoot, displayIndex });

    this.logger.log(
      `Handbook sync: ${result.created} created, ${result.updated} updated, ${result.unchanged} unchanged, ${result.deleted} deleted, ${result.failed.length} failed`,
    );

    return result;
  }

  /**
   * Writes the display translation onto the pages the English walk produced.
   *
   * The English tree is the source of truth for WHICH pages exist: a translated
   * file whose path has no English counterpart is counted and skipped, never
   * created. Creating it would put an unindexed page in the manual and — worse,
   * once someone pressed sync again — an English-less page in the retrieval
   * store.
   *
   * Nothing here chunks, embeds or enqueues. `updateDisplay` writes three
   * properties; `content`, `contentHash` and `aiStatus` are untouched, so the
   * index after this pass is byte-for-byte the index before it.
   */
  private async syncDisplay(params: {
    displayRoot: string;
    displayIndex: { sections: Map<string, { title: string; summary?: string }>; summaries: Map<string, string> };
  }): Promise<void> {
    const files = this.walk(params.displayRoot, params.displayIndex.summaries);

    // Re-read rather than reuse the map built before the walk: on a first sync
    // that map is empty, because every page was created moments ago, and every
    // translation would be reported as an orphan.
    const pages = await this.handbookPageRepository.findAllPages();
    const byPath = new Map<string, HandbookPage>(pages.map((page) => [page.path, page]));

    let translated = 0;
    let orphaned = 0;

    for (const file of files) {
      const page = byPath.get(file.path);
      if (!page) {
        orphaned++;
        continue;
      }

      await this.handbookPageRepository.updateDisplay({
        id: page.id,
        displayTitle: file.title,
        displaySummary: file.summary,
        displayContent: file.content,
      });
      translated++;
    }

    this.logger.log(
      `Handbook display translation (${this.config.displayPath}): ${translated} pages translated, ${orphaned} translated files with no English counterpart`,
    );
  }

  private walk(root: string, summaries: Map<string, string> = new Map()): WalkedFile[] {
    const out: WalkedFile[] = [];

    const visit = (directory: string) => {
      for (const entry of readdirSync(directory, { withFileTypes: true })) {
        const absolute = join(directory, entry.name);
        if (entry.isDirectory()) {
          visit(absolute);
          continue;
        }
        if (!entry.name.endsWith(".md")) continue;

        const path = relative(root, absolute).split(sep).join("/");
        if (this.isExcluded(path)) continue;

        const raw = readFileSync(absolute, "utf8");
        const { frontmatter, body } = this.splitFrontmatter(raw);

        // Declared section first, then the directory the file sits in. A file at
        // the tree root with no declaration gets "", and is dropped from the
        // section list rather than inventing an unnamed one.
        const section = frontmatter.section ?? path.split("/").slice(0, -1)[0] ?? "";

        out.push({
          path,
          section,
          order: path.toLowerCase(),
          summary: summaries.get(path),
          // The BODY is what gets stored, rendered and chunked. Frontmatter is
          // metadata about the file, not prose about the subject: embedding
          // `sources_verified: 2026-09-10` teaches the retriever nothing and
          // dilutes the chunk it lands in.
          content: body,
          title: this.titleOf({ frontmatterTitle: frontmatter.title, content: body, path }),
          // Hashed over the RAW file (so editing only the frontmatter still
          // re-ingests the page) plus the format version (so changing the parser
          // re-ingests every page).
          hash: createHash("sha256").update(`${INGEST_FORMAT_VERSION}\n${raw}`).digest("hex"),
          wordCount: body.split(/\s+/).filter(Boolean).length,
        });
      }
    };

    visit(root);
    return out;
  }

  /**
   * Glob support is deliberately the smallest thing that serves the config:
   * a literal prefix with a trailing `**`, or an exact path. No dependency,
   * nothing to misread.
   */
  private isExcluded(path: string): boolean {
    return this.config.exclude.some((pattern) => {
      if (pattern.endsWith("/**")) return path.startsWith(pattern.slice(0, -2));
      if (pattern.endsWith("**")) return path.startsWith(pattern.slice(0, -2));
      return path === pattern;
    });
  }

  /**
   * Splits a leading YAML frontmatter block off a markdown file and returns its
   * scalar keys.
   *
   * Still not a YAML parser: the block this reads is a handful of `key: value`
   * lines, and a dependency buys nothing but new failure modes on a malformed
   * block. Nested structures and lists are ignored rather than half-parsed.
   */
  private splitFrontmatter(raw: string): { frontmatter: Record<string, string>; body: string } {
    const match = raw.match(/^---\r?\n([\s\S]*?)\r?\n---\r?\n?/);
    if (!match) return { frontmatter: {}, body: raw };

    const frontmatter: Record<string, string> = {};
    for (const line of match[1].split(/\r?\n/)) {
      const pair = line.match(/^([A-Za-z0-9_-]+):\s*(.*)$/);
      if (!pair) continue;
      const value = pair[2].trim().replace(/^["']|["']$/g, "");
      if (value) frontmatter[pair[1]] = value;
    }

    return { frontmatter, body: raw.slice(match[0].length).trimStart() };
  }

  /**
   * The tree's own `README.md` index, parsed — or empty maps when it has none.
   *
   * Both roots go through this: the English tree and, when one is configured,
   * the display tree. A display README's link paths are relative to the display
   * root, which IS the English relative path, so the summaries it yields key
   * straight onto the English pages.
   */
  private readIndex(directory: string): {
    sections: Map<string, { title: string; summary?: string }>;
    summaries: Map<string, string>;
  } {
    const indexPath = join(directory, "README.md");
    return existsSync(indexPath) ? this.parseIndex(readFileSync(indexPath, "utf8")) : this.emptyIndex();
  }

  private emptyIndex(): {
    sections: Map<string, { title: string; summary?: string }>;
    summaries: Map<string, string>;
  } {
    return { sections: new Map<string, { title: string; summary?: string }>(), summaries: new Map<string, string>() };
  }

  /**
   * Reads the tree's own `README.md` index, when it has one.
   *
   * Two maps come out: section key to its heading title and blurb, and
   * repo-relative path to the one-line description the index gives it. Both are
   * optional by construction — an application with no README gets empty maps,
   * prettified section titles and pages with no summary, and the manual still
   * renders.
   */
  private parseIndex(readme: string): {
    sections: Map<string, { title: string; summary?: string }>;
    summaries: Map<string, string>;
  } {
    const sections = new Map<string, { title: string; summary?: string }>();
    const summaries = new Map<string, string>();

    const blocks = readme.split(/^##\s+/m).slice(1);
    for (const block of blocks) {
      const lines = block.split(/\r?\n/);
      const key = lines[0].trim();
      sections.set(key, { title: this.sectionTitle(key), summary: this.blurbOf(lines.slice(1)) });
    }

    // `- [Title](path) — summary` across the whole file, section blocks included.
    const entry = /^-\s*\[[^\]]+\]\(([^)]+)\)\s*[—–-]\s*(.+)$/gm;
    for (const match of readme.matchAll(entry)) {
      const path = match[1].split("#")[0].trim();
      if (path.length > 0) summaries.set(path, match[2].trim());
    }

    return { sections, summaries };
  }

  /**
   * The paragraph beneath a section heading, rebuilt into one sentence.
   *
   * A README wraps its prose, so the blurb arrives as several lines; joining
   * the contiguous run is the difference between a summary and a sentence cut
   * at "and an index". Collection starts at the first line that is neither
   * blank, nor a list item, nor inside a fenced code block, and stops at the
   * first blank line or list item after that.
   *
   * Fenced blocks are stepped over whole: a section that opens with one — the
   * a360 handbook's own `## Checking the handbook` does — must be summarised by
   * its prose, not by a fence or by the command inside it.
   */
  private blurbOf(lines: string[]): string | undefined {
    const paragraph: string[] = [];
    let fenced = false;

    for (const raw of lines) {
      const line = raw.trim();

      if (line.startsWith("```")) {
        fenced = !fenced;
        continue;
      }
      if (fenced) continue;

      if (line.length === 0 || line.startsWith("-")) {
        if (paragraph.length > 0) break;
        continue;
      }

      paragraph.push(line);
    }

    return paragraph.length > 0 ? paragraph.join(" ") : undefined;
  }

  /**
   * `00-start-here` becomes "Start here". The numeric prefix orders the
   * directories on disk and is noise on screen; a key with no prefix is used
   * as written.
   */
  private sectionTitle(key: string): string {
    const words = key.replace(/^\d+-/, "").replace(/-/g, " ").trim();
    if (words.length === 0) return key;
    return words.charAt(0).toUpperCase() + words.slice(1);
  }

  /**
   * Frontmatter `title` first, then the first H1, then the filename. The
   * handbook this was built against uses frontmatter and no H1 at all, so the
   * H1 branch exists for directories that are written the other way.
   */
  private titleOf(params: { frontmatterTitle?: string; content: string; path: string }): string {
    if (params.frontmatterTitle) return params.frontmatterTitle;

    const heading = params.content.match(/^#\s+(.+)$/m);
    if (heading) return heading[1].trim();

    const name = params.path.split("/").pop() ?? params.path;
    return name.replace(/\.md$/, "");
  }
}
