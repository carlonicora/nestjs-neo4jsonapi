import { BadRequestException, Injectable, NotFoundException } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { EventEmitter2 } from "@nestjs/event-emitter";
import { ClsService } from "nestjs-cls";
import { BaseConfigInterface } from "../../../config/interfaces/base.config.interface";
import { ConfigAiInterface } from "../../../config/interfaces/config.ai.interface";
import { JsonApiService } from "../../../core/jsonapi/services/jsonapi.service";
import {
  AI_CONNECTION_TYPES,
  AI_CONNECTIONS_CHANGED_EVENT,
  AiConnectionType,
} from "../../../core/llm/interfaces/ai-candidate.interface";
import { AbstractService } from "../../../core/neo4j/abstracts/abstract.service";
import { AiConnection, AiConnectionDescriptor } from "../entities/ai-connection";
import { AI_PROVIDER_REGISTRY, validateAiConnectionAttributes } from "../registry/ai-provider.registry";
import { AiConnectionRepository } from "../repositories/ai-connection.repository";
import { AiConnectionEncryptionService } from "./ai-connection-encryption.service";

const SECRET_FIELDS = ["apiKey", "googleCredentialsBase64"] as const;

@Injectable()
export class AiConnectionService extends AbstractService<AiConnection, typeof AiConnectionDescriptor.relationships> {
  protected readonly descriptor = AiConnectionDescriptor;

  constructor(
    jsonApiService: JsonApiService,
    private readonly aiConnectionRepository: AiConnectionRepository,
    clsService: ClsService,
    private readonly encryption: AiConnectionEncryptionService,
    private readonly eventEmitter: EventEmitter2,
    private readonly configService: ConfigService<BaseConfigInterface>,
  ) {
    super(jsonApiService, aiConnectionRepository, clsService, AiConnectionDescriptor.model);
  }

  /**
   * List with the editor's meta: the provider field registry and the .env
   * defaults per connection type (never secrets) — spec § 3.
   */
  async findAllWithMeta(params: { query: any }): Promise<any> {
    const response = await this.find({ query: params.query, fetchAll: true });
    const ai = this.configService.get<ConfigAiInterface>("ai");
    const envBlockFor = (type: AiConnectionType) => {
      switch (type) {
        case "aiLite":
          return ai?.aiLite;
        case "aiLarge":
          return ai?.aiLarge;
        case "vision":
          return ai?.vision;
        case "audio":
          return ai?.audio;
        case "image":
          return ai?.image;
        case "embedder":
          return ai?.embedder;
        case "transcriber":
          return ai?.transcriber;
        case "documentAi":
          return ai?.documentAi;
        default:
          return ai?.ai;
      }
    };
    const envDefaults = Object.fromEntries(
      AI_CONNECTION_TYPES.map((type) => {
        const block = envBlockFor(type) as { provider?: string; model?: string; url?: string } | undefined;
        return [type, { provider: block?.provider, model: block?.model, url: block?.url }];
      }),
    );
    response.meta = { ...(response.meta ?? {}), providerRegistry: AI_PROVIDER_REGISTRY, envDefaults };
    return response;
  }

  /**
   * Create from a JSON:API body: validate against the provider registry,
   * encrypt secrets, persist, then refresh every resolver snapshot.
   *
   * This name shadows `AbstractService.create()`, which `createFromDTO()` calls
   * back into with *mapped repository params* (`{ id, ...fields }`) — routing
   * those through the body path would recurse forever. The shape guard below
   * keeps both entry points working: a JSON:API body always carries `data`,
   * mapped repository params never do.
   */
  async create(body: any, included?: unknown[]): Promise<any> {
    if (!body?.data) return super.create(body, included);

    this.validateAndEncrypt(body.data.attributes);
    const response = await this.createFromDTO({ data: body.data as any });
    this.eventEmitter.emit(AI_CONNECTIONS_CHANGED_EVENT);
    return response;
  }

  async update(body: { data: { id: string; attributes: Record<string, any>; [k: string]: any } }): Promise<any> {
    const existing = await this.aiConnectionRepository.findById({ id: body.data.id });
    // Blank/omitted secret = keep the stored (already encrypted) value; a
    // supplied one is validated + re-encrypted (spec § Decisions "Secrets").
    const attributes = body.data.attributes;
    const suppliedSecrets = new Set<string>();
    for (const field of SECRET_FIELDS) {
      const value = attributes[field];
      if (value === undefined || value === null || value === "") {
        const stored = (existing as any)?.[field];
        if (stored === undefined || stored === null) {
          // No stored value either: the key must be ABSENT, not undefined — the
          // PUT query builder emits a SET term for every present key while the
          // param mapper strips undefined values, so an undefined key produces
          // "Neo4jError: Expected parameter(s): <field>".
          delete attributes[field];
        } else {
          attributes[field] = stored;
        }
      } else {
        suppliedSecrets.add(field);
      }
    }
    this.validateAndEncrypt(attributes, suppliedSecrets);
    const response = await this.putFromDTO({ data: body.data as any });
    this.eventEmitter.emit(AI_CONNECTIONS_CHANGED_EVENT);
    return response;
  }

  async reorder(params: { ids: string[] }): Promise<void> {
    // A reorder is defined over exactly one chain (connectionType + scope) —
    // a malformed request mixing chains would scramble positions across them.
    const connections = await this.aiConnectionRepository.findByIds({ ids: params.ids });
    if (connections.length !== params.ids.length) {
      throw new BadRequestException("One or more connections in the reorder request do not exist");
    }
    const chains = new Set(connections.map((c) => `${c.connectionType}|${c.companyId ?? "global"}`));
    if (chains.size > 1) {
      throw new BadRequestException("Reorder must target a single chain (one connection type and scope)");
    }
    await this.aiConnectionRepository.updatePositions({ ids: params.ids });
    this.eventEmitter.emit(AI_CONNECTIONS_CHANGED_EVENT);
  }

  async deleteConnection(params: { id: string }): Promise<void> {
    await this.delete({ id: params.id });
    this.eventEmitter.emit(AI_CONNECTIONS_CHANGED_EVENT);
  }

  /**
   * The inherited `AbstractService.delete()` enforces company ownership
   * (`clsService.companyId === entity.company?.id`). That check is meaningless
   * here and would reject every delete: this entity is `isCompanyScoped: false`
   * and its `company` edge is the CONFIGURES *target* (the company a chain is
   * scoped TO), not an owner — a global connection has no company at all, so
   * `"" !== undefined` would always throw ForbiddenException.
   *
   * Authorisation is enforced at the controller (`AdminJwtAuthGuard` +
   * `@Roles(RoleId.Administrator)`), matching every other admin-only foundation.
   */
  async delete(params: { id: string }): Promise<void> {
    const entity = await this.aiConnectionRepository.findById({ id: params.id });
    if (!entity) throw new NotFoundException();

    await this.aiConnectionRepository.delete({ id: params.id });
  }

  /**
   * Registry validation + secret encryption. `onlyEncrypt` limits encryption to
   * the secrets this request actually supplied (update path: kept secrets are
   * already ciphertext).
   */
  private validateAndEncrypt(attributes: Record<string, any>, onlyEncrypt?: Set<string>): void {
    validateAiConnectionAttributes({
      connectionType: attributes.connectionType,
      provider: attributes.provider,
      attributes,
    });
    for (const field of SECRET_FIELDS) {
      const value = attributes[field];
      const mustEncrypt =
        value !== undefined && value !== null && value !== "" && (!onlyEncrypt || onlyEncrypt.has(field));
      if (!mustEncrypt) continue;
      if (!this.encryption.isConfigured()) {
        throw new BadRequestException("ENCRYPTION_KEY is not configured — cannot store AI connection secrets");
      }
      attributes[field] = this.encryption.encrypt(String(value));
    }
  }
}
