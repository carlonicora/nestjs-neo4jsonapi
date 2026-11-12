import { beforeEach, describe, it, expect, vi } from "vitest";
import { Injectable } from "@nestjs/common";
import { Test } from "@nestjs/testing";
import { ClsService } from "nestjs-cls";
import { AbstractRepository } from "../abstract.repository";
import { Neo4jService } from "../../services/neo4j.service";
import { SecurityService } from "../../../security/services/security.service";
import { EntityDescriptor } from "../../../../common/interfaces/entity.schema.interface";
import { DataModelInterface } from "../../../../common/interfaces/datamodel.interface";
import { EntityFactory } from "../../factories/entity.factory";
import { TokenResolverService } from "../../services/token-resolver.service";

// projectNodeOmitting: a RETURN column in the node shape EntityFactory maps, carrying the
// properties the descriptor's mapper reads minus the named ones (e.g. an `embedding` vector a
// scoring read computes on but never uses). An explicit list, never `.*`.

type Host = { id: string; content: string; embedding?: number[]; summary?: string; score?: number };
type Other = { id: string; name: string; abstract?: string };

const descriptor = (fieldNames: string[], computed: string[] = [], virtualFields: string[] = []) =>
  ({
    fieldNames,
    computed: Object.fromEntries(computed.map((name) => [name, { compute: vi.fn() }])),
    virtualFields: Object.fromEntries(virtualFields.map((name) => [name, { compute: vi.fn() }])),
  }) as unknown as EntityDescriptor<any, any>;

const HOST = descriptor(["content", "embedding", "summary"], ["score"], ["preview"]);
const OTHER = descriptor(["name", "abstract"]) as EntityDescriptor<Other, any>;

@Injectable()
class HostRepository extends AbstractRepository<Host, any> {
  protected readonly descriptor = HOST as EntityDescriptor<Host, any>;
  constructor(neo4j: Neo4jService, securityService: SecurityService, clsService: ClsService) {
    super(neo4j, securityService, clsService);
  }
  public project(alias: string, omit: readonly (keyof Host & string)[]): string {
    return this.projectNodeOmitting(alias, omit);
  }
  public projectOther(alias: string, omit: readonly (keyof Other & string)[]): string {
    return this.projectNodeOmitting(alias, omit, OTHER);
  }
}

describe("AbstractRepository.projectNodeOmitting", () => {
  let repository: HostRepository;

  beforeEach(async () => {
    const module = await Test.createTestingModule({
      providers: [
        HostRepository,
        {
          provide: Neo4jService,
          useValue: { initQuery: vi.fn(), readOne: vi.fn(), readMany: vi.fn(), writeOne: vi.fn() },
        },
        { provide: SecurityService, useValue: { userHasAccess: vi.fn() } },
        { provide: ClsService, useValue: { has: vi.fn(), get: vi.fn() } },
      ],
    }).compile();
    repository = module.get(HostRepository);
  });

  it("returns a node-shaped map under the same alias, listing every mapped property but the omitted one", () => {
    expect(repository.project("host", ["embedding"])).toBe(
      "CASE WHEN host IS NULL THEN NULL ELSE { labels: labels(host), properties: host " +
        "{ .`id`, .`createdAt`, .`updatedAt`, .`content`, .`summary`, .`score`, .`preview` } } END AS host",
    );
  });

  it("never uses .* (it would still load the omitted properties)", () => {
    expect(repository.project("host", ["embedding"])).not.toContain(".*");
  });

  it("omits several properties", () => {
    const cypher = repository.project("host", ["embedding", "summary"]);
    expect(cypher).toContain("host { .`id`, .`createdAt`, .`updatedAt`, .`content`, .`score`, .`preview` }");
    expect(cypher).not.toContain("embedding");
    expect(cypher).not.toContain("summary");
  });

  it("projects a related node from the given descriptor", () => {
    expect(repository.projectOther("host_other", ["abstract"])).toBe(
      "CASE WHEN host_other IS NULL THEN NULL ELSE { labels: labels(host_other), properties: host_other " +
        "{ .`id`, .`createdAt`, .`updatedAt`, .`name` } } END AS host_other",
    );
  });

  it("refuses an omitted property name that is not a plain identifier", () => {
    expect(() => repository.project("host", ["embedding` : 1 } //" as any])).toThrow(/invalid property names/);
  });

  it("refuses an alias that is not a plain identifier", () => {
    expect(() => repository.project("host) RETURN 1 //", ["embedding"])).toThrow(
      'projectNodeOmitting: invalid alias "host) RETURN 1 //"',
    );
    expect(() => repository.projectOther("host-other", ["abstract"])).toThrow(/invalid alias/);
  });
});

describe("EntityFactory maps the omitting projection like a node", () => {
  it("maps the root node and keeps every non-omitted property", () => {
    const hostModel: DataModelInterface<any> = {
      type: "hosts",
      endpoint: "hosts",
      nodeName: "host",
      labelName: "Host",
      entity: undefined as any,
      mapper: vi.fn((params: { data: any }) => ({
        id: params.data.id,
        content: params.data.content,
        embedding: params.data.embedding ?? undefined,
        labels: params.data.labels,
      })),
    };
    // Shape the projection RETURNs for `host`.
    const cols: Record<string, unknown> = {
      host: { labels: ["Host"], properties: { id: "h1", content: "text", summary: null } },
      score: 0.5,
    };
    const record = { keys: Object.keys(cols), has: (k: string) => k in cols, get: (k: string) => cols[k] };

    const [host] = new EntityFactory(new TokenResolverService()).createGraphList({
      model: hostModel,
      records: [record as any],
    });

    expect(host).toEqual({ id: "h1", content: "text", embedding: undefined, labels: ["Host"] });
  });

  it("leaves out a listed property the node does not store (projected as null)", () => {
    const mapper = vi.fn((params: { data: any }) => ({ ...params.data }));
    const hostModel: DataModelInterface<any> = {
      type: "hosts",
      endpoint: "hosts",
      nodeName: "host",
      labelName: "Host",
      entity: undefined as any,
      mapper,
    };
    const cols: Record<string, unknown> = {
      host: { labels: ["Host"], properties: { id: "h1", content: "text", summary: null, flag: false, count: 0 } },
    };
    const record = { keys: Object.keys(cols), has: (k: string) => k in cols, get: (k: string) => cols[k] };

    const [host] = new EntityFactory(new TokenResolverService()).createGraphList({
      model: hostModel,
      records: [record as any],
    });

    expect(mapper).toHaveBeenCalledWith(
      expect.objectContaining({ data: { id: "h1", content: "text", flag: false, count: 0, labels: ["Host"] } }),
    );
    expect(host).not.toHaveProperty("summary");
  });
});
