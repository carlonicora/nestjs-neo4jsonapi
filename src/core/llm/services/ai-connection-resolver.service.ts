import { Injectable, OnModuleInit, Optional } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { OnEvent } from "@nestjs/event-emitter";
import { ClsService } from "nestjs-cls";
import { BaseConfigInterface, ConfigAiInterface } from "../../../config/interfaces";
import type { AiConnection } from "../../../foundations/ai-connection/entities/ai-connection";
import { AiConnectionRepository } from "../../../foundations/ai-connection/repositories/ai-connection.repository";
import { AiConnectionEncryptionService } from "../../../foundations/ai-connection/services/ai-connection-encryption.service";
import { AppLoggingService } from "../../logging/services/logging.service";
import {
  AI_CONNECTIONS_CHANGED_EVENT,
  AI_CONNECTION_TYPES,
  AiConnectionType,
  ResolvedAiCandidate,
} from "../interfaces/ai-candidate.interface";

/** How often the in-memory snapshot is rebuilt from the database. */
const SNAPSHOT_REFRESH_INTERVAL_MS = 60_000;

/** Cooldown used when `ai.connectionCooldownMinutes` is missing from config. */
const DEFAULT_COOLDOWN_MINUTES = 5;

/** Snapshot key for the chain that applies to every company. */
const GLOBAL_SCOPE = "global";

const KNOWN_CONNECTION_TYPES: ReadonlySet<string> = new Set<string>(AI_CONNECTION_TYPES);

/**
 * Loose view of one `ai` config sub-block. The blocks are heterogeneous (a chat
 * tier has no `dimensions`, the embedder has no `costPerMinute`), so the mapper
 * reads them structurally and narrows each value with the helpers below.
 */
type EnvBlock = Record<string, unknown>;

const asString = (value: unknown): string | undefined =>
  typeof value === "string" && value !== "" ? value : undefined;

const asNumber = (value: unknown): number | undefined => (typeof value === "number" ? value : undefined);

const asBoolean = (value: unknown): boolean | undefined => (typeof value === "boolean" ? value : undefined);

/**
 * Normalises one `AiConnection` node into the candidate shape `buildChatModel`
 * (and its embedder/transcriber siblings) already consume.
 *
 * Pure on purpose: the decryptor is injected so the caller decides what a
 * decryption failure means. It THROWS when a stored secret cannot be decrypted —
 * {@link AiConnectionResolverService.refreshNow} catches that and skips the
 * connection, so a single unreadable secret never takes the chain down
 * (spec § 5 "Error handling").
 */
export function toCandidate(connection: AiConnection, decrypt: (value: string) => string): ResolvedAiCandidate {
  return {
    source: "db",
    connectionId: connection.id,
    connectionType: connection.connectionType as AiConnectionType,
    provider: connection.provider,
    apiKey: connection.apiKey ? decrypt(connection.apiKey) : "",
    model: connection.model ?? "",
    url: connection.url ?? "",
    region: connection.region,
    instance: connection.instance,
    apiVersion: connection.apiVersion,
    googleCredentialsBase64: connection.googleCredentialsBase64
      ? decrypt(connection.googleCredentialsBase64)
      : undefined,
    allowFallbacks: connection.allowFallbacks,
    reasoningEffort: connection.reasoningEffort,
    maxOutputTokens: connection.maxOutputTokens,
    dimensions: connection.dimensions,
    inputCostPer1MTokens: connection.inputCostPer1MTokens,
    outputCostPer1MTokens: connection.outputCostPer1MTokens,
    cachedInputCostPer1MTokens: connection.cachedInputCostPer1MTokens,
    costPerMinute: connection.costPerMinute,
    costPerPage: connection.costPerPage,
    directUrl: connection.directUrl,
    language: connection.language,
    directFormat: connection.directFormat,
    directProvider: connection.directProvider,
  };
}

/**
 * Resolves the ordered fallback chain for an AI connection type.
 *
 * Holds an in-memory snapshot of every enabled `AiConnection` node (decrypted,
 * grouped into chains by `(connectionType, companyId | null)`, ordered by
 * `position`), refreshed at boot, every 60s, and immediately on any admin write
 * in this process (`AI_CONNECTIONS_CHANGED_EVENT`).
 *
 * The snapshot exists because `ModelService.getLLM()` is synchronous and called
 * directly by several library services: resolution must stay a pure sync lookup
 * with no signature ripple (spec § 2).
 *
 * Failure ALWAYS degrades toward today's `.env` behaviour, never toward "no AI"
 * (spec § 5): an empty table, a failed refresh, an undecryptable secret or an
 * unknown connection type all leave the `.env` candidate in place, and nothing
 * on the `resolve()` hot path throws.
 */
@Injectable()
export class AiConnectionResolverService implements OnModuleInit {
  /** `${connectionType}|${companyId ?? "global"}` → ordered candidates. */
  private snapshot = new Map<string, ResolvedAiCandidate[]>();

  /** connectionId → epoch ms before which the candidate is skipped. */
  private readonly cooldownUntil = new Map<string, number>();

  private refreshTimer?: ReturnType<typeof setInterval>;

  constructor(
    private readonly repository: AiConnectionRepository,
    private readonly encryption: AiConnectionEncryptionService,
    private readonly cls: ClsService,
    private readonly configService: ConfigService<BaseConfigInterface>,
    // Optional so unit harnesses can construct the resolver without the whole
    // logging module — same pattern as `ModelService`'s optional logger.
    @Optional() private readonly logger?: AppLoggingService,
  ) {}

  /**
   * Loads the first snapshot and starts the periodic refresh. Neither is
   * awaited and neither can reject: boot must never depend on the database
   * holding AI connection rows (spec § 5).
   */
  onModuleInit(): void {
    void this.refreshNow().catch((error) => this.warn("initial snapshot load failed", error));
    this.refreshTimer = setInterval(() => {
      void this.refreshNow().catch((error) => this.warn("scheduled snapshot refresh failed", error));
    }, SNAPSHOT_REFRESH_INTERVAL_MS);
    // Never hold the process open for a cache refresh.
    this.refreshTimer.unref?.();
  }

  /**
   * The ordered candidates to try for `type`, best first.
   *
   * Per-company chain when the request's company has one, otherwise the global
   * chain; the `.env` block is ALWAYS appended last. Candidates inside their
   * cooldown window are dropped — unless that empties the list, in which case
   * the full chain is returned anyway (fail-open, spec § 2).
   *
   * Never throws.
   */
  resolve(type: AiConnectionType): ResolvedAiCandidate[] {
    const candidates: ResolvedAiCandidate[] = [];

    try {
      const companyId = this.currentCompanyId();
      if (companyId) {
        const scoped = this.snapshot.get(this.chainKey(type, companyId));
        if (scoped?.length) candidates.push(...scoped);
      }
      if (candidates.length === 0) {
        const global = this.snapshot.get(this.chainKey(type, undefined));
        if (global?.length) candidates.push(...global);
      }
    } catch (error) {
      // A broken CLS/snapshot read degrades to the env candidate alone.
      this.warn(`chain lookup failed for "${type}"`, error);
      candidates.length = 0;
    }

    candidates.push(this.buildEnvCandidate(type));

    const now = Date.now();
    const healthy = candidates.filter((candidate) => (this.cooldownUntil.get(candidate.connectionId) ?? 0) <= now);
    return healthy.length > 0 ? healthy : candidates;
  }

  /**
   * Parks a connection for `ai.connectionCooldownMinutes` after a transient
   * failure (429 / 5xx / network). The `.env` candidate is tracked under
   * `env:<type>` like any other, so a dead env fallback cannot block recovery.
   */
  markFailure(connectionId: string): void {
    if (!connectionId) return;
    this.cooldownUntil.set(connectionId, Date.now() + this.cooldownMinutes * 60_000);
  }

  /**
   * Rebuilds the snapshot from the database. Also the handler for admin writes
   * in this process; other processes catch up at the next scheduled refresh.
   *
   * A read failure keeps the PREVIOUS snapshot — a database blip must not wipe
   * working configuration (spec § 5).
   */
  @OnEvent(AI_CONNECTIONS_CHANGED_EVENT)
  async refreshNow(): Promise<void> {
    let connections: AiConnection[];
    try {
      connections = await this.readConnections();
    } catch (error) {
      this.warn("snapshot refresh failed — keeping the previous snapshot", error);
      return;
    }

    const next = new Map<string, ResolvedAiCandidate[]>();

    const ordered = [...(connections ?? [])].sort((a, b) => (a?.position ?? 0) - (b?.position ?? 0));
    for (const connection of ordered) {
      if (!connection || connection.enabled === false) continue;

      if (!KNOWN_CONNECTION_TYPES.has(connection.connectionType)) {
        this.warn(`skipping connection ${connection.id}: unknown connectionType "${connection.connectionType}"`);
        continue;
      }

      let candidate: ResolvedAiCandidate;
      try {
        candidate = toCandidate(connection, (value) => this.encryption.decrypt(value));
      } catch (error) {
        this.warn(`skipping connection ${connection.id}: stored secret could not be decrypted`, error);
        continue;
      }

      const key = this.chainKey(candidate.connectionType, connection.companyId);
      const chain = next.get(key);
      if (chain) chain.push(candidate);
      else next.set(key, [candidate]);
    }

    this.snapshot = next;
  }

  // --- internals ----------------------------------------------------------

  /**
   * Reads every connection inside a CLS context: the refresh runs outside any
   * HTTP request, and the query plumbing reads CLS (`companyId`) unconditionally.
   */
  private readConnections(): Promise<AiConnection[]> {
    if (typeof this.cls?.run === "function") {
      return this.cls.run(async () => this.repository.findAllForResolver());
    }
    return this.repository.findAllForResolver();
  }

  /**
   * The company of the current request, or undefined when there is none.
   *
   * Optional-call plus a silent catch: the resolver is also used by workers and
   * boot-time code with no CLS context at all, which is an ordinary state and
   * must not log or throw — it simply means "use the global chain".
   */
  private currentCompanyId(): string | undefined {
    try {
      const companyId = this.cls?.get?.("companyId");
      return typeof companyId === "string" && companyId !== "" ? companyId : undefined;
    } catch {
      return undefined;
    }
  }

  private chainKey(type: AiConnectionType | string, companyId: string | undefined): string {
    return `${type}|${companyId ?? GLOBAL_SCOPE}`;
  }

  private get aiConfig(): ConfigAiInterface | undefined {
    try {
      return this.configService?.get<ConfigAiInterface>("ai");
    } catch {
      return undefined;
    }
  }

  private get cooldownMinutes(): number {
    // `connectionCooldownMinutes` is added to the `ai` block by the config task;
    // default defensively so this works even when the read returns undefined.
    const ai = this.aiConfig as ({ connectionCooldownMinutes?: number } & ConfigAiInterface) | undefined;
    const configured = ai?.connectionCooldownMinutes;
    return typeof configured === "number" && configured > 0 ? configured : DEFAULT_COOLDOWN_MINUTES;
  }

  /**
   * The `.env` block for a type, mapped field-for-field onto a candidate. This
   * is the final link of every chain and the whole behaviour when the table is
   * empty — with zero `AiConnection` nodes, resolution is byte-for-byte today's.
   */
  private buildEnvCandidate(type: AiConnectionType): ResolvedAiCandidate {
    const block = this.envBlockFor(type);
    return {
      source: "env",
      connectionId: `env:${type}`,
      connectionType: type,
      provider: asString(block.provider) ?? "",
      apiKey: asString(block.apiKey) ?? "",
      model: asString(block.model) ?? "",
      url: asString(block.url) ?? "",
      region: asString(block.region),
      instance: asString(block.instance),
      apiVersion: asString(block.apiVersion),
      googleCredentialsBase64: asString(block.googleCredentialsBase64),
      allowFallbacks: asBoolean(block.allowFallbacks),
      reasoningEffort: asString(block.reasoningEffort),
      maxOutputTokens: asNumber(block.maxOutputTokens),
      dimensions: asNumber(block.dimensions),
      inputCostPer1MTokens: asNumber(block.inputCostPer1MTokens),
      outputCostPer1MTokens: asNumber(block.outputCostPer1MTokens),
      cachedInputCostPer1MTokens: asNumber(block.cachedInputCostPer1MTokens),
      costPerMinute: asNumber(block.costPerMinute),
      costPerPage: asNumber(block.costPerPage),
      directUrl: asString(block.directUrl),
      language: asString(block.language),
      directFormat: asString(block.directFormat),
      directProvider: asString(block.directProvider),
    };
  }

  /** Same block mapping the admin API uses for `meta.envDefaults`. */
  private envBlockFor(type: AiConnectionType): EnvBlock {
    const ai = this.aiConfig;
    if (!ai) return {};
    switch (type) {
      case "aiLite":
        return (ai.aiLite ?? {}) as EnvBlock;
      case "aiLarge":
        return (ai.aiLarge ?? {}) as EnvBlock;
      case "vision":
        return (ai.vision ?? {}) as EnvBlock;
      case "audio":
        return (ai.audio ?? {}) as EnvBlock;
      case "embedder":
        return (ai.embedder ?? {}) as EnvBlock;
      case "transcriber":
        return (ai.transcriber ?? {}) as EnvBlock;
      case "documentAi":
        return (ai.documentAi ?? {}) as EnvBlock;
      default:
        return (ai.ai ?? {}) as EnvBlock;
    }
  }

  private warn(message: string, error?: unknown): void {
    const detail = error instanceof Error ? error.message : error !== undefined ? String(error) : undefined;
    this.logger?.warn(
      detail ? `[AiConnectionResolver] ${message}: ${detail}` : `[AiConnectionResolver] ${message}`,
      AiConnectionResolverService.name,
    );
  }
}
