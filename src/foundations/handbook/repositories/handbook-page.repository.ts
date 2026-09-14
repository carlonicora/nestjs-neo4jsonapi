import { Injectable, OnModuleInit } from "@nestjs/common";
import { ClsService } from "nestjs-cls";
import { AiStatus } from "../../../common/enums/ai.status";
import { JsonApiCursorInterface } from "../../../core/jsonapi/interfaces/jsonapi.cursor.interface";
import { AbstractRepository } from "../../../core/neo4j/abstracts/abstract.repository";
import { Neo4jService } from "../../../core/neo4j/services/neo4j.service";
import { FilterCriterion, SortCriterion } from "../../../core/neo4j/types/filter.criterion";
import { SecurityService } from "../../../core/security/services/security.service";
import { chunkMeta } from "../../chunk/entities/chunk.meta";
import { HandbookPage, HandbookPageDescriptor } from "../entities/handbook-page";
import { handbookPageMeta } from "../entities/handbook-page.meta";

@Injectable()
export class HandbookPageRepository
  extends AbstractRepository<HandbookPage, typeof HandbookPageDescriptor.relationships>
  implements OnModuleInit
{
  protected readonly descriptor = HandbookPageDescriptor;

  constructor(neo4j: Neo4jService, securityService: SecurityService, clsService: ClsService) {
    super(neo4j, securityService, clsService);
  }

  /**
   * `path` is the natural key of the ingest: the walk looks a page up by the
   * file it came from. The descriptor only auto-creates the `id` constraint
   * (common/helpers/define-entity.ts:387), so this one is declared here — the
   * same place ChunkRepository declares its own indexes.
   *
   * `super.onModuleInit()` runs FIRST and is not optional: the base
   * implementation is what turns the descriptor's `constraints` and `indexes`
   * into real Neo4j objects. Overriding it without delegating would silently
   * drop the `id` uniqueness constraint and the descriptor's FULLTEXT index —
   * the bug NotificationRepository avoids by re-declaring its `id` constraint
   * by hand. Delegating keeps the database config derived from the descriptor.
   */
  async onModuleInit(): Promise<void> {
    await super.onModuleInit();

    await this.neo4j.writeOne({
      query: `CREATE CONSTRAINT handbookpage_path IF NOT EXISTS FOR (${handbookPageMeta.nodeName}:${handbookPageMeta.labelName}) REQUIRE ${handbookPageMeta.nodeName}.path IS UNIQUE`,
    });
  }

  /**
   * The list is a manual's table of contents, not an audit log.
   *
   * `AbstractRepository.find` orders by `descriptor.defaultOrderBy`, which
   * `defineEntity` hardcodes to `updatedAt DESC` and exposes no way to override
   * — so without this the rows arrive in reverse ingest order and `09-workflow`
   * renders before `00-start-here`. The one ordering hook `find` does offer a
   * caller is `orderByFields`, a multi-key `SortCriterion[]`; supplying a
   * default for it puts `ORDER BY handbookPage.section ASC, handbookPage.order
   * ASC` ahead of `{CURSOR}` in the inherited query and leaves the fulltext
   * branch, the structured filters, the security snippet and the pagination
   * exactly as the framework builds them.
   *
   * `order` is the repo-relative path, so sorting on it inside a section
   * reproduces the filesystem, which is already meaningful. An explicit
   * `orderBy` or `orderByFields` from the request still wins.
   */
  async find(params: {
    fetchAll?: boolean;
    term?: string;
    orderBy?: string;
    orderByFields?: SortCriterion[];
    filters?: FilterCriterion[];
    cursor?: JsonApiCursorInterface;
  }): Promise<HandbookPage[]> {
    const ordered = params.orderByFields?.length || params.orderBy;

    return super.find({
      ...params,
      orderByFields: ordered
        ? params.orderByFields
        : [
            { field: "section", direction: "asc" },
            { field: "order", direction: "asc" },
          ],
    });
  }

  /** Every page, unpaginated — the ingest diffs the whole tree in one pass. */
  async findAllPages(): Promise<HandbookPage[]> {
    const query = this.neo4j.initQuery({ serialiser: HandbookPageDescriptor.model });
    query.query = `
      ${this.buildDefaultMatch()}
      ORDER BY ${handbookPageMeta.nodeName}.path ASC
      ${this.buildReturnStatement()}
    `;
    return this.neo4j.readMany(query);
  }

  async findByPath(params: { path: string }): Promise<HandbookPage | null> {
    const query = this.neo4j.initQuery({ serialiser: HandbookPageDescriptor.model });
    query.queryParams = { ...query.queryParams, path: params.path };
    query.query = `
      ${this.buildDefaultMatch()}
      WHERE ${handbookPageMeta.nodeName}.path = $path
      ${this.buildReturnStatement()}
    `;
    return this.neo4j.readOne(query);
  }

  /**
   * Provenance for one answer: the repo-relative path of the page each cited
   * chunk belongs to, in the order the chunks were cited.
   *
   * This does NOT go through `readMany`, because the result is not a
   * `HandbookPage` — it is one scalar column. Raw records never leave this
   * method: the mapping to `string[]` happens here, and a row whose `path` is
   * missing is dropped rather than returned as an empty string. A chunk whose
   * page no longer exists simply does not match, so it disappears from the
   * provenance list instead of appearing as a blank source.
   */
  async findPathsByChunkIds(params: { chunkIds: string[] }): Promise<string[]> {
    if (params.chunkIds.length === 0) return [];

    const result = await this.neo4j.read(
      `
      UNWIND $chunkIds AS chunkId
      MATCH (${handbookPageMeta.nodeName}:${handbookPageMeta.labelName})-[:HAS_CHUNK]->(${chunkMeta.nodeName}:${chunkMeta.labelName} {id: chunkId})
      RETURN ${handbookPageMeta.nodeName}.path AS path
    `,
      { chunkIds: params.chunkIds },
    );

    return (result?.records ?? [])
      .map((record: any) => record.get("path"))
      .filter((path: unknown): path is string => typeof path === "string" && path.length > 0);
  }

  async createPage(params: {
    id: string;
    path: string;
    title: string;
    content: string;
    contentHash: string;
    wordCount: number;
    section: string;
    order: string;
    summary?: string;
  }): Promise<void> {
    const query = this.neo4j.initQuery();
    query.queryParams = {
      ...query.queryParams,
      ...params,
      // A page the index does not list has no summary. `null` clears the
      // property in Cypher; `undefined` is not a legal driver parameter.
      summary: params.summary ?? null,
      aiStatus: AiStatus.Pending,
    };
    query.query = `
      CREATE (${handbookPageMeta.nodeName}:${handbookPageMeta.labelName} {
        id: $id,
        path: $path,
        title: $title,
        content: $content,
        contentHash: $contentHash,
        wordCount: $wordCount,
        aiStatus: $aiStatus,
        section: $section,
        order: $order,
        summary: $summary,
        createdAt: datetime(),
        updatedAt: datetime()
      })
    `;
    await this.neo4j.writeOne(query);
  }

  async updatePage(params: {
    id: string;
    title: string;
    content: string;
    contentHash: string;
    wordCount: number;
    section: string;
    order: string;
    summary?: string;
  }): Promise<void> {
    const query = this.neo4j.initQuery();
    query.queryParams = {
      ...query.queryParams,
      ...params,
      summary: params.summary ?? null,
      aiStatus: AiStatus.Pending,
    };
    query.query = `
      MATCH (${handbookPageMeta.nodeName}:${handbookPageMeta.labelName} {id: $id})
      SET ${handbookPageMeta.nodeName}.title = $title,
          ${handbookPageMeta.nodeName}.content = $content,
          ${handbookPageMeta.nodeName}.contentHash = $contentHash,
          ${handbookPageMeta.nodeName}.wordCount = $wordCount,
          ${handbookPageMeta.nodeName}.aiStatus = $aiStatus,
          ${handbookPageMeta.nodeName}.section = $section,
          ${handbookPageMeta.nodeName}.order = $order,
          ${handbookPageMeta.nodeName}.summary = $summary,
          ${handbookPageMeta.nodeName}.updatedAt = datetime()
    `;
    await this.neo4j.writeOne(query);
  }

  /**
   * Index fields only — no content, no hash, no chunk work.
   *
   * The walk calls this for a page whose bytes did not change, so that a sync
   * which only adds new index data (a README summary, a frontmatter `section`)
   * costs nothing in embeddings. Bumping INGEST_FORMAT_VERSION instead would
   * change every contentHash and re-embed the whole tree.
   */
  async updateMetadata(params: {
    id: string;
    title: string;
    section: string;
    order: string;
    summary?: string;
  }): Promise<void> {
    const query = this.neo4j.initQuery();
    query.queryParams = { ...query.queryParams, ...params, summary: params.summary ?? null };
    query.query = `
      MATCH (${handbookPageMeta.nodeName}:${handbookPageMeta.labelName} {id: $id})
      SET ${handbookPageMeta.nodeName}.title = $title,
          ${handbookPageMeta.nodeName}.section = $section,
          ${handbookPageMeta.nodeName}.order = $order,
          ${handbookPageMeta.nodeName}.summary = $summary,
          ${handbookPageMeta.nodeName}.updatedAt = datetime()
    `;
    await this.neo4j.writeOne(query);
  }

  /**
   * The display translation of one page — title, summary and body.
   *
   * Display fields ONLY. No content, no contentHash, no aiStatus, no chunk
   * work: the page is indexed in English and shown in the display language, so
   * a translation that arrives, changes or disappears must leave the retrieval
   * store byte-for-byte as it was. Writing `content` here, or bumping the hash,
   * would re-chunk and re-embed the page in the translated language and poison
   * the index the handbook answers from.
   *
   * Every value is bound, and an absent one is bound as `null` rather than
   * omitted: `null` CLEARS the property, which is what a page whose translation
   * was deleted needs, and `undefined` is not a legal driver parameter.
   */
  async updateDisplay(params: {
    id: string;
    displayTitle?: string;
    displaySummary?: string;
    displayContent?: string;
  }): Promise<void> {
    const query = this.neo4j.initQuery();
    query.queryParams = {
      ...query.queryParams,
      id: params.id,
      displayTitle: params.displayTitle ?? null,
      displaySummary: params.displaySummary ?? null,
      displayContent: params.displayContent ?? null,
    };
    query.query = `
      MATCH (${handbookPageMeta.nodeName}:${handbookPageMeta.labelName} {id: $id})
      SET ${handbookPageMeta.nodeName}.displayTitle = $displayTitle,
          ${handbookPageMeta.nodeName}.displaySummary = $displaySummary,
          ${handbookPageMeta.nodeName}.displayContent = $displayContent,
          ${handbookPageMeta.nodeName}.updatedAt = datetime()
    `;
    await this.neo4j.writeOne(query);
  }

  async updateStatus(params: { id: string; aiStatus: AiStatus }): Promise<void> {
    const query = this.neo4j.initQuery();
    query.queryParams = { ...query.queryParams, id: params.id, aiStatus: params.aiStatus };
    query.query = `
      MATCH (${handbookPageMeta.nodeName}:${handbookPageMeta.labelName} {id: $id})
      SET ${handbookPageMeta.nodeName}.aiStatus = $aiStatus, ${handbookPageMeta.nodeName}.updatedAt = datetime()
    `;
    await this.neo4j.writeOne(query);
  }

  async deletePage(params: { id: string }): Promise<void> {
    const query = this.neo4j.initQuery();
    query.queryParams = { ...query.queryParams, id: params.id };
    query.query = `
      MATCH (${handbookPageMeta.nodeName}:${handbookPageMeta.labelName} {id: $id})
      DETACH DELETE ${handbookPageMeta.nodeName}
    `;
    await this.neo4j.writeOne(query);
  }
}
