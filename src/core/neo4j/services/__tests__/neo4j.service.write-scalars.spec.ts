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
 * writeScalars: one write through the driver session (executeWrite, never executeRead), each
 * record converted exactly as readScalars converts it. Harness copied from
 * neo4j.service.read-scalars.spec.ts.
 *
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
    executeWrite: vi.fn(async (work: (t: typeof tx) => Promise<unknown>) => work(tx)),
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

describe("Neo4jService.writeScalars", () => {
  it("runs the statement in a write session and maps each row", async () => {
    const { service, run, session } = await makeService([record({ id: "rec-1" })]);
    const query = "MATCH (n {id: $id}) SET n.x = 1 RETURN n.id AS id";

    const rows = await service.writeScalars({ query, queryParams: { id: "rec-1" }, map: (row) => row.id });

    expect(rows).toEqual(["rec-1"]);
    expect(session.executeWrite).toHaveBeenCalledTimes(1);
    expect(session.executeRead).not.toHaveBeenCalled();
    expect(run).toHaveBeenCalledWith(query, { id: "rec-1" });
  });

  it("converts driver integers and temporal values like readScalars", async () => {
    const { service } = await makeService([
      record({ total: neo4j.int(5), at: new neo4j.types.DateTime(2026, 11, 9, 10, 30, 15, 0, 0) }),
    ]);

    const [row] = await service.writeScalars({ query: "RETURN 5 AS total", map: (r) => r });

    expect(row).toEqual({ total: 5, at: "2026-11-09T10:30:15.000Z" });
  });

  it("returns [] when the write matched no row", async () => {
    const { service } = await makeService([]);
    const map = vi.fn();

    await expect(
      service.writeScalars({ query: "MATCH (n:Nothing) SET n.x = 1 RETURN n.id AS id", map }),
    ).resolves.toEqual([]);
    expect(map).not.toHaveBeenCalled();
  });
});
