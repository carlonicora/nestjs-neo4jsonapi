import { describe, expect, it, vi } from "vitest";
import type { Mocked } from "vitest";
import { ConfigService } from "@nestjs/config";
import { Test } from "@nestjs/testing";
import { ClsService } from "nestjs-cls";
import neo4j, { Record as Neo4jRecord } from "neo4j-driver";
import { AppLoggingService } from "../../../logging/services/logging.service";
import { EntityFactory } from "../../factories/entity.factory";
import { Neo4jService } from "../neo4j.service";

/**
 * readScalars: one read through the driver session, each record turned into a plain object
 * (driver Integer → number, temporal → ISO string, nested lists and maps converted the same way)
 * and handed to the caller's mapper. No company scope is added.
 *
 * The service is built through its constructor, as neo4j.service.spec.ts does: neo4j-driver's
 * `driver()` is mocked to hand back a driver whose session is the current test's double. The
 * rest of neo4j-driver (Integer, temporal types, Record) stays real, so the conversions run on
 * real driver values.
 */
const driverSession = vi.hoisted(() => ({ current: undefined as unknown }));

vi.mock("neo4j-driver", async () => {
  const actual = await vi.importActual<typeof import("neo4j-driver")>("neo4j-driver");
  return {
    ...actual,
    driver: () => ({ session: () => driverSession.current, close: async () => undefined }),
  };
});

const makeService = async (records: Neo4jRecord[]) => {
  const run = vi.fn().mockResolvedValue({ records });
  const tx = { run };
  const session = {
    executeRead: vi.fn(async (work: (t: typeof tx) => Promise<unknown>) => work(tx)),
    close: vi.fn().mockResolvedValue(undefined),
  };
  driverSession.current = session;
  const logger: Mocked<Pick<AppLoggingService, "log" | "error">> = { log: vi.fn(), error: vi.fn() };

  const module = await Test.createTestingModule({
    providers: [
      Neo4jService,
      { provide: EntityFactory, useValue: {} },
      { provide: ClsService, useValue: {} },
      { provide: AppLoggingService, useValue: logger },
      {
        provide: ConfigService,
        useValue: new ConfigService({
          neo4j: { uri: "bolt://localhost:7687", username: "neo4j", password: "password", database: "neo4j" },
        }),
      },
    ],
  }).compile();

  return { service: module.get(Neo4jService), run, session };
};

const record = (values: Record<string, unknown>): Neo4jRecord =>
  new Neo4jRecord(Object.keys(values), Object.values(values));

describe("Neo4jService.readScalars", () => {
  it("maps each row with the mapper", async () => {
    const { service } = await makeService([record({ value: "a", count: 1 }), record({ value: "b", count: 2 })]);

    const rows = await service.readScalars({
      query: "MATCH (n) RETURN n.value AS value, count(n) AS count",
      map: (row) => ({ label: `${row.value}:${row.count}` }),
    });

    expect(rows).toEqual([{ label: "a:1" }, { label: "b:2" }]);
  });

  it("converts driver integers to numbers", async () => {
    const { service } = await makeService([
      record({ total: neo4j.int(5), list: [neo4j.int(1), neo4j.int(2)], nested: { inner: neo4j.int(7) } }),
    ]);

    const [row] = await service.readScalars({ query: "RETURN 5 AS total", map: (r) => r });

    expect(row).toEqual({ total: 5, list: [1, 2], nested: { inner: 7 } });
    expect(typeof row.total).toBe("number");
  });

  it("converts a Date and a DateTime to ISO strings", async () => {
    const { service } = await makeService([
      record({
        day: new neo4j.types.Date(2026, 11, 9),
        at: new neo4j.types.DateTime(2026, 11, 9, 10, 30, 15, 0, 0),
        nullable: null,
      }),
    ]);

    const [row] = await service.readScalars({ query: "RETURN date() AS day", map: (r) => r });

    expect(row).toEqual({ day: "2026-11-09", at: "2026-11-09T10:30:15.000Z", nullable: null });
  });

  it("returns [] for no rows", async () => {
    const { service } = await makeService([]);
    const map = vi.fn();

    const rows = await service.readScalars({ query: "MATCH (n:Nothing) RETURN n.id AS id", map });

    expect(rows).toEqual([]);
    expect(map).not.toHaveBeenCalled();
  });

  it("never prepends a company match", async () => {
    const { service, run } = await makeService([]);
    const query = "MATCH (j:Judgement) RETURN count(j) AS total";

    await service.readScalars({ query, queryParams: { a: 1 }, map: (r) => r });

    expect(run).toHaveBeenCalledWith(query, { a: 1 });
  });
});
