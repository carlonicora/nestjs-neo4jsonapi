import { Injectable, Logger } from "@nestjs/common";
import type { FastifyRequest } from "fastify";
import { ClsService } from "nestjs-cls";
import { entityDescriptorRegistry } from "../../../common/registries/entity-descriptor.registry";
import { JsonApiSingleDocument } from "../../../core/jsonapi/interfaces/jsonapi.document.interface";
import { JsonApiService } from "../../../core/jsonapi/services/jsonapi.service";
import { AbstractService, JsonApiDTOData } from "../../../core/neo4j/abstracts/abstract.service";
import {
  OfflineChange,
  OfflineChangeResult,
  OfflineChangeSet,
  OfflineChangeSetDescriptor,
} from "../entities/offline-change-set";
import { jsonEqual } from "../merge/deep-equal";
import { MergeResolution, Resource, threeWayMerge } from "../merge/three-way-merge";
import { OfflineChangeSetRepository } from "../repositories/offline-change-set.repository";
import { OfflineRouteAnswer, OfflineRouteRunner } from "./offline-route-runner.service";

type CurrentRecord =
  | { kind: "found"; resource: Resource; document: Record<string, unknown> }
  | { kind: "deleted" }
  | { kind: "failed"; detail: string };

const isOk = (status: number) => status >= 200 && status < 300;

/** The reason an app route gave for refusing a step (JSON:API errors, Nest's error body, or the status). */
function errorDetail(status: number, body: any): string {
  const error = Array.isArray(body?.errors) ? body.errors[0] : undefined;
  if (error?.detail) return String(error.detail);
  if (error?.title) return String(error.title);
  if (Array.isArray(body?.message)) return body.message.join("; ");
  if (typeof body?.message === "string" && body.message) return body.message;
  if (typeof body === "string" && body) return body;
  return `HTTP ${status}`;
}

/** Values the server sets on every write or recomputes on every read: never a change by anyone. */
const VOLATILE_ATTRIBUTES = new Set(["createdAt", "updatedAt"]);

/**
 * Attributes only the server (the AI workers) writes. Descriptors carry no marker for them (the
 * app declares them as plain fields), so they are named here; a field marked `immutable` (never
 * written by a client save) counts too. A change to them is never "changed on the server".
 */
const SERVER_WRITTEN_ATTRIBUTES = new Set(["aiStatus", "summary", "tldr"]);

/** How long a stored change set (a package's results, kept for a resend) is kept. */
const STORED_CHANGE_SET_DAYS = 7;

/** `npcs/n1?x`, `/npcs/n1` or an absolute URL → `["npcs", "n1"]`. */
function pathSegments(path: string): string[] {
  let pathname = path.split("?")[0];
  if (/^https?:\/\//i.test(pathname)) pathname = new URL(pathname).pathname;
  return pathname.split("/").filter((s) => s.length > 0);
}

const linkageIds = (rel: any): string[] | undefined => {
  if (!rel || typeof rel !== "object" || !("data" in rel)) return undefined;
  const data = rel.data;
  if (data == null) return [];
  return (Array.isArray(data) ? data : [data]).map((d: any) => d.id).sort();
};

/**
 * Opens one offline change set (every change the device queued, in one request) and handles
 * each change in `seq` order through the app's own routes, as the caller (`OfflineRouteRunner`).
 *
 * - POST, and any write that names no record, runs as sent.
 * - PUT/PATCH of a record: the current record is read (GET on the record's own path,
 *   `<endpoint>/<id>`) and merged with `base` and the device's document (`threeWayMerge`);
 *   only the changed fields are written, as a PATCH of the device's document trimmed to them
 *   (merged rich text in place). A change carrying `resolution` merges the same way, and each
 *   conflicting field takes the GM's choice.
 * - DELETE of a record: refused as "changed on the server" when a descriptor field or a
 *   linked id changed since `base`; with `resolution` (delete anyway) it runs without that check.
 * - After a conflict or a could-not-apply, later changes to the same record wait (a custom
 *   write `<endpoint>/<id>/...` counts as a change of that record).
 * - A package is opened once: its results are stored under its id (company-scoped) and a
 *   package sent again with the same id is answered with them, without running anything.
 *
 * The package is never paged, batched or capped.
 */
@Injectable()
export class OfflineChangeSetService extends AbstractService<
  OfflineChangeSet,
  typeof OfflineChangeSetDescriptor.relationships
> {
  protected readonly descriptor = OfflineChangeSetDescriptor;
  private readonly logger = new Logger(OfflineChangeSetService.name);

  constructor(
    jsonApiService: JsonApiService,
    private readonly offlineChangeSetRepository: OfflineChangeSetRepository,
    clsService: ClsService,
    private readonly runner: OfflineRouteRunner,
  ) {
    super(jsonApiService, offlineChangeSetRepository, clsService, OfflineChangeSetDescriptor.model);
  }

  async apply(params: { data: JsonApiDTOData; request: FastifyRequest }): Promise<JsonApiSingleDocument> {
    const id = params.data.id;

    await this.removeExpired();

    const stored = await this.repository.findById({ id });
    if (stored) return this.jsonApiService.buildSingle(OfflineChangeSetDescriptor.model, stored);

    const changes: OfflineChange[] = [...((params.data.attributes?.changes as OfflineChange[]) ?? [])].sort(
      (a, b) => a.seq - b.seq,
    );

    const blocked = new Set<string>();
    const results: OfflineChangeResult[] = [];

    for (const change of changes) {
      const key = this.recordKey(change);
      if (key && blocked.has(key)) {
        results.push({ seq: change.seq, status: "waiting" });
        continue;
      }

      let result: OfflineChangeResult;
      try {
        result = await this.applyChange(change, params.request);
      } catch (error) {
        result = { seq: change.seq, status: "could-not-apply", detail: (error as Error)?.message ?? String(error) };
      }

      if (key && (result.status === "conflict" || result.status === "could-not-apply")) blocked.add(key);
      results.push(result);
    }

    try {
      await this.repository.create({ id, resultsJson: JSON.stringify(results) });
    } catch (error) {
      // The changes ran: answer them. A package sent again would run once more, as before this store existed.
      this.logger.error(`offline change set ${id}: results not stored: ${(error as Error)?.message ?? error}`);
    }

    return this.jsonApiService.buildSingle(OfflineChangeSetDescriptor.model, { id, results });
  }

  /**
   * Removes the company's stored change sets older than `STORED_CHANGE_SET_DAYS`: a device sends a
   * package again only right after a failed answer, never days later. A failed clean-up is
   * logged and never stops the package.
   */
  private async removeExpired(): Promise<void> {
    const before = new Date(Date.now() - STORED_CHANGE_SET_DAYS * 24 * 60 * 60 * 1000);
    try {
      await this.offlineChangeSetRepository.deleteOlderThan({ before });
    } catch (error) {
      this.logger.error(`offline change sets: clean-up failed: ${(error as Error)?.message ?? error}`);
    }
  }

  /** The JSON:API type answering on an endpoint (the type is the endpoint unless a descriptor says otherwise). */
  private typeOfEndpoint(endpoint: string): string {
    return entityDescriptorRegistry.getByEndpoint(endpoint)?.model?.type ?? endpoint;
  }

  /** The record's own path: `<its type's endpoint>/<id>`. */
  private recordPath(change: OfflineChange): string {
    const type = change.recordType as string;
    const endpoint = entityDescriptorRegistry.get(type)?.model?.endpoint ?? type;
    return `${endpoint}/${change.recordId}`;
  }

  /** The record a change touches: its record fields, the resource a create posts, or the `<endpoint>/<id>` its path targets. */
  private recordKey(change: OfflineChange): string | undefined {
    if (change.recordType && change.recordId) return `${change.recordType}:${change.recordId}`;
    const data = (change.body as any)?.data;
    if (change.method === "POST" && typeof data?.type === "string" && typeof data?.id === "string")
      return `${data.type}:${data.id}`;
    const [endpoint, recordId] = pathSegments(change.path);
    if (endpoint && recordId) return `${this.typeOfEndpoint(endpoint)}:${recordId}`;
    return undefined;
  }

  private async applyChange(change: OfflineChange, request: FastifyRequest): Promise<OfflineChangeResult> {
    const namesRecord = !!change.recordType && !!change.recordId;
    if (!namesRecord || change.method === "POST") return this.runAsSent(change, request);
    if (change.method === "DELETE") return this.applyDelete(change, request);
    return this.applyEdit(change, request);
  }

  private async runAsSent(change: OfflineChange, request: FastifyRequest): Promise<OfflineChangeResult> {
    const answer = await this.runner.run({ method: change.method, path: change.path, body: change.body, request });
    return this.toResult(change.seq, answer);
  }

  private toResult(seq: number, answer: OfflineRouteAnswer): OfflineChangeResult {
    if (answer.ran === false) return { seq, status: "could-not-apply", detail: answer.detail };
    if (!isOk(answer.status))
      return { seq, status: "could-not-apply", detail: errorDetail(answer.status, answer.body) };
    return answer.body && typeof answer.body === "object"
      ? { seq, status: "applied", response: answer.body }
      : { seq, status: "applied" };
  }

  private async readCurrent(change: OfflineChange, request: FastifyRequest): Promise<CurrentRecord> {
    const answer = await this.runner.run({ method: "GET", path: this.recordPath(change), request });
    if (answer.ran === false) return { kind: "failed", detail: answer.detail };
    if (answer.status === 404) return { kind: "deleted" };
    if (!isOk(answer.status)) return { kind: "failed", detail: errorDetail(answer.status, answer.body) };
    const resource = answer.body?.data;
    if (!resource || typeof resource !== "object" || Array.isArray(resource)) return { kind: "deleted" };
    return { kind: "found", resource, document: answer.body };
  }

  /**
   * Relationship names the record's GET always answers when it has a link (the serialiser
   * emits every descriptor relationship and omits only an empty one), so an omitted one is empty.
   */
  private knownRelationships(type: string | undefined): string[] {
    const descriptor = type ? entityDescriptorRegistry.get(type) : undefined;
    return Object.entries(descriptor?.relationships ?? {}).map(([name, rel]: [string, any]) => rel?.dtoKey ?? name);
  }

  private mergeResolution(change: OfflineChange): MergeResolution | undefined {
    const resolution = change.resolution;
    if (!resolution) return undefined;
    const merged = (resolution.mergedBody as any)?.data;
    return {
      choices: resolution.choices,
      all: resolution.kind === "mine" ? "mine" : undefined,
      merged: merged && typeof merged === "object" ? merged : undefined,
    };
  }

  private async applyEdit(change: OfflineChange, request: FastifyRequest): Promise<OfflineChangeResult> {
    const current = await this.readCurrent(change, request);
    if (current.kind === "deleted")
      return { seq: change.seq, status: "conflict", conflict: "deleted-on-server", current: null };
    if (current.kind === "failed") return { seq: change.seq, status: "could-not-apply", detail: current.detail };

    const body = (change.body ?? {}) as Record<string, any>;
    const mine: Resource = body.data ?? {};
    const theirs = current.resource;
    const base: Resource = (change.base as Resource) ?? theirs;

    const merge = threeWayMerge({
      base,
      mine,
      theirs,
      richTextFields: entityDescriptorRegistry.richTextFields(change.recordType as string),
      knownRelationships: this.knownRelationships(change.recordType),
      resolution: this.mergeResolution(change),
    });

    if (merge.conflictFields.length > 0)
      return {
        seq: change.seq,
        status: "conflict",
        conflict: "fields",
        current: theirs,
        merged: merge.attributes,
        conflictFields: merge.conflictFields,
        conflictBlocks: merge.conflictBlocks,
      };

    if (merge.changed.length === 0) return { seq: change.seq, status: "applied", response: current.document };

    // The device's model-built document (decision "1a"), trimmed in place: fields the merge says
    // nobody needs to write are removed, merged values (rich text included) replace the device's.
    // Nothing is rebuilt: type, id and every other member stay as the device's model wrote them.
    const trimmed = structuredClone(body) as { data: Record<string, any> } & Record<string, unknown>;
    const data = trimmed.data;
    for (const name of Object.keys(data.attributes ?? {})) {
      if (merge.changed.includes(name)) data.attributes[name] = merge.attributes[name];
      else delete data.attributes[name];
    }
    for (const name of Object.keys(data.relationships ?? {})) {
      if (merge.changed.includes(name) && name in merge.relationships)
        data.relationships[name] = merge.relationships[name];
      else delete data.relationships[name];
    }
    if (data.relationships && Object.keys(data.relationships).length === 0) delete data.relationships;

    const answer = await this.runner.run({ method: "PATCH", path: change.path, body: trimmed, request });
    return this.toResult(change.seq, answer);
  }

  private async applyDelete(change: OfflineChange, request: FastifyRequest): Promise<OfflineChangeResult> {
    if (!change.resolution) {
      const current = await this.readCurrent(change, request);
      if (current.kind === "deleted") return { seq: change.seq, status: "applied" };
      if (current.kind === "failed") return { seq: change.seq, status: "could-not-apply", detail: current.detail };

      if (change.base && this.changedSince(change.recordType as string, change.base as Resource, current.resource))
        return { seq: change.seq, status: "conflict", conflict: "changed-on-server", current: current.resource };
    }

    const answer = await this.runner.run({ method: "DELETE", path: change.path, body: change.body, request });
    // Already gone: what the GM asked for holds.
    if (answer.ran === true && answer.status === 404) return { seq: change.seq, status: "applied" };
    return this.toResult(change.seq, answer);
  }

  /**
   * The attributes a change could have touched: the descriptor's fields that go on the wire as
   * stored (no transform, such as a signed URL; not meta; not excluded), minus createdAt/updatedAt
   * and the fields only the server writes (`SERVER_WRITTEN_ATTRIBUTES`, `immutable` fields).
   * `undefined` for an unknown type (every attribute base holds is compared, minus those names).
   */
  private comparableAttributes(type: string): Set<string> | undefined {
    const descriptor = entityDescriptorRegistry.get(type);
    if (!descriptor) return undefined;
    const names = Object.entries(descriptor.fields ?? {})
      .filter(
        ([name, def]: [string, any]) =>
          !VOLATILE_ATTRIBUTES.has(name) &&
          !SERVER_WRITTEN_ATTRIBUTES.has(name) &&
          !def?.immutable &&
          !def?.transform &&
          !def?.meta &&
          !def?.excludeFromJsonApi &&
          def?.serialise !== false,
      )
      .map(([name]) => name);
    return new Set(names);
  }

  /** A descriptor field or a linked id of the record differs from `base`. */
  private changedSince(type: string, base: Resource, theirs: Resource): boolean {
    const comparable = this.comparableAttributes(type);
    for (const [name, value] of Object.entries(base.attributes ?? {})) {
      if (comparable ? !comparable.has(name) : VOLATILE_ATTRIBUTES.has(name) || SERVER_WRITTEN_ATTRIBUTES.has(name))
        continue;
      if (!jsonEqual(value, theirs.attributes?.[name])) return true;
    }
    const known = new Set(this.knownRelationships(type));
    for (const [name, rel] of Object.entries(base.relationships ?? {})) {
      const baseIds = linkageIds(rel);
      const theirsRel = theirs.relationships?.[name] ?? (known.has(name) ? { data: null } : undefined);
      const theirsIds = linkageIds(theirsRel);
      if (baseIds !== undefined && theirsIds !== undefined && !jsonEqual(baseIds, theirsIds)) return true;
    }
    return false;
  }
}
