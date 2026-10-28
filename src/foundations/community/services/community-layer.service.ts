import { Injectable, OnApplicationBootstrap, Optional } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { GraphCatalogService } from "../../../agents/graph/services/graph.catalog.service";
import { entityTenancyRegistry } from "../../../common/registries/entity-tenancy.registry";
import { ConfigCommunityInterface } from "../../../config/interfaces/config.community.interface";

/** The chat-scope root topic groups are built in. */
export type CommunityLayer = { type: string; labelName: string; nodeName: string };

/**
 * Resolves the topic-group layer named by the app config `community.scope`.
 *
 * Omitted: `current()` is `undefined` and groups are built per company. Set: it must
 * name a chat-scope root (an entity with `chat.scope: "self"`) whose label is
 * company-scoped, or the boot stops with an error naming the key.
 */
@Injectable()
export class CommunityLayerService implements OnApplicationBootstrap {
  private resolved = false;
  private layer: CommunityLayer | undefined;
  private markBootstrapped!: () => void;
  private readonly bootstrapped = new Promise<void>((resolve) => (this.markBootstrapped = resolve));

  constructor(
    private readonly configService: ConfigService,
    @Optional() private readonly catalog?: GraphCatalogService,
  ) {}

  onApplicationBootstrap(): void {
    this.layer = this.resolve();
    this.resolved = true;
    this.markBootstrapped();
  }

  /**
   * The configured layer once the application has bootstrapped; `undefined` = company layer.
   *
   * Queue workers start consuming during module init, while feature modules are still
   * registering their descriptors with the catalog: a layer resolved then would not find
   * the root type. A job that starts early waits here until boot has resolved the layer.
   */
  async ready(): Promise<CommunityLayer | undefined> {
    await this.bootstrapped;
    return this.layer;
  }

  /** The resolved layer; `undefined` = company layer. Throws before bootstrap: use `ready()`. */
  current(): CommunityLayer | undefined {
    if (!this.resolved)
      throw new Error("CommunityLayerService.current() called before application bootstrap; await ready() instead");
    return this.layer;
  }

  private resolve(): CommunityLayer | undefined {
    const scope = this.configService.get<ConfigCommunityInterface>("community")?.scope;
    if (!scope) return undefined;

    const fail = (reason: string): never => {
      throw new Error(
        `community.scope "${scope}" must name a chat-scope root (an entity with chat.scope: "self"); found ${reason}.`,
      );
    };

    if (!this.catalog) return fail("no graph catalog loaded");

    // The catalog builds itself in its own onApplicationBootstrap; boot order is not guaranteed.
    if (this.catalog.getAllEntities().length === 0) this.catalog.buildCatalog();

    const entity = this.catalog.getAllEntities().find((candidate) => candidate.type === scope);
    if (!entity) return fail("no catalog entity of that type");
    if (!entity.scope) return fail("an entity with no chat.scope");
    if (entity.scope.viaService) return fail("an entity scoped by its service (chat.scopeByService)");
    if (entity.scope.path.length !== 0 || entity.scope.rootType !== entity.type)
      return fail(`an entity scoped under "${entity.scope.rootType}"`);
    if (entityTenancyRegistry.get(entity.labelName)?.isCompanyScoped === false)
      return fail(`label "${entity.labelName}", which is not company-scoped`);

    return { type: entity.type, labelName: entity.labelName, nodeName: entity.nodeName };
  }
}
