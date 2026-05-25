import { Inject, Injectable, Logger, OnApplicationBootstrap } from "@nestjs/common";
import { ClsService } from "nestjs-cls";
import { HowToRepository } from "../../how-to/repositories/how-to.repository";
import { HowToService } from "../../how-to/services/how-to.service";
import { RedisLockService } from "../../../core/redis/services/redis.lock.service";
import { MdxToMarkdownService } from "./mdx-to-markdown.service";
import { HELP_CONTENT_CONFIG_TOKEN } from "../tokens";
import { HelpContentConfig } from "../interfaces/help-content-config.interface";
import { toContentId } from "../helpers/to-content-id";

const LOCK_KEY = "nestjs-neo4jsonapi:help-content-sync:lock";
const LOCK_TTL_SECONDS = 300;

@Injectable()
export class HelpContentSyncService implements OnApplicationBootstrap {
  private readonly logger = new Logger(HelpContentSyncService.name);

  constructor(
    @Inject(HELP_CONTENT_CONFIG_TOKEN) private readonly config: HelpContentConfig,
    private readonly howToRepository: HowToRepository,
    private readonly howToService: HowToService,
    private readonly mdxToMarkdown: MdxToMarkdownService,
    private readonly lock: RedisLockService,
    private readonly clsService: ClsService,
  ) {}

  onApplicationBootstrap(): void {
    void this.run().catch((err) =>
      this.logger.error(`Help content sync failed: ${(err as Error).message}`, (err as Error).stack),
    );
  }

  async run(): Promise<void> {
    await this.lock.withLock(LOCK_KEY, LOCK_TTL_SECONDS, async () => {
      await this.clsService.run(async () => {
        await this.runInsideCls();
      });
    });
  }

  private async runInsideCls(): Promise<void> {
    const articles = this.config.manifest.filter((a) => a.aiIndexed && !a.draft);
    let created = 0,
      updated = 0,
      skipped = 0,
      redirected = 0,
      deleted = 0;

    for (const article of articles) {
      const id = toContentId(article.mode, article.slug, this.config.namespaceUuid);
      const existing = await this.howToService.findRecordById({ id });
      const plainMarkdown = await this.mdxToMarkdown.convert(await this.config.readRawMarkdown(article));

      const baseFields = {
        id,
        name: article.title,
        description: article.summary,
        pages: plainMarkdown,
        helpContentSlug: `${article.mode}/${article.slug}`,
        contentHash: article.contentHash,
      };

      if (!existing) {
        await this.howToRepository.create(baseFields);
        await this.howToService.queueHowToForProcessingFromMarkdown({
          howToId: id,
          markdown: plainMarkdown,
        });
        created++;
      } else if (existing.contentHash !== article.contentHash) {
        await this.howToRepository.patch(baseFields);
        await this.howToService.queueHowToForProcessingFromMarkdown({
          howToId: id,
          markdown: plainMarkdown,
        });
        updated++;
      } else {
        skipped++;
      }
    }

    const manifestSlugs = new Set(articles.map((a) => `${a.mode}/${a.slug}`));
    const managed = await this.howToRepository.findAllWithHelpContentSlug();
    const redirects = this.config.redirects ?? [];

    for (const orphan of managed) {
      if (!orphan.helpContentSlug || manifestSlugs.has(orphan.helpContentSlug)) continue;
      const moved = redirects.find((r) => r.from === orphan.helpContentSlug);
      if (moved) {
        await this.howToRepository.patch({ id: orphan.id, helpContentSlug: moved.to });
        redirected++;
      } else {
        await this.howToRepository.delete({ id: orphan.id });
        deleted++;
      }
    }

    this.logger.log(
      `Help content sync done — created=${created} updated=${updated} skipped=${skipped} redirected=${redirected} deleted=${deleted}`,
    );
  }
}
