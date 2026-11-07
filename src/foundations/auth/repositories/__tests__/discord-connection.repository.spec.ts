import { vi, describe, it, expect, beforeEach } from "vitest";
import type { Mocked } from "vitest";
import { NotFoundException } from "@nestjs/common";
import { ClsService } from "nestjs-cls";
import { Neo4jService } from "../../../../core/neo4j/services/neo4j.service";
import { SecurityService } from "../../../../core/security/services/security.service";
import { DiscordConnectionRepository } from "../discord-connection.repository";

type Neo4jMock = Mocked<Pick<Neo4jService, "initQuery" | "readOne">>;

describe("DiscordConnectionRepository", () => {
  let neo4j: Neo4jMock;
  let cls: Record<string, string>;
  let repository: DiscordConnectionRepository;
  let query: { query: string; queryParams: Record<string, unknown> };

  beforeEach(() => {
    query = { query: "PRELUDE", queryParams: { companyId: "c-1", currentUserId: "u-1" } };
    neo4j = {
      initQuery: vi.fn(() => query) as unknown as Neo4jMock["initQuery"],
      readOne: vi.fn() as unknown as Neo4jMock["readOne"],
    };
    cls = { userId: "u-1", companyId: "c-1" };
    const clsService = { get: vi.fn((key: string) => cls[key]), has: vi.fn(() => true) } as unknown as ClsService;
    repository = new DiscordConnectionRepository(neo4j as unknown as Neo4jService, {} as SecurityService, clsService);
  });

  it("buildReturnStatement computes connected and the Discord name", () => {
    const statement = (repository as any).buildReturnStatement();

    expect(statement).toContain("OPTIONAL MATCH (discordConnection)-[:HAS_DISCORD]->(du:DiscordUser)");
    expect(statement).toContain("du IS NOT NULL AS connected");
    expect(statement).toContain("du.name AS discordName");
  });

  it("findCurrent binds searchValue and keeps the initQuery params", async () => {
    neo4j.readOne.mockResolvedValue({ id: "u-1", connected: false });

    await expect(repository.findCurrent({ id: "u-1" })).resolves.toEqual({ id: "u-1", connected: false });

    expect(query.queryParams).toEqual({ companyId: "c-1", currentUserId: "u-1", searchValue: "u-1" });
    expect(query.query.startsWith("PRELUDE")).toBe(true);
    expect(query.query).toContain("MATCH (discordConnection:User {id: $searchValue})");
  });

  it("findCurrent with another user's id throws NotFound without querying", async () => {
    await expect(repository.findCurrent({ id: "u-2" })).rejects.toBeInstanceOf(NotFoundException);
    expect(neo4j.initQuery).not.toHaveBeenCalled();
    expect(neo4j.readOne).not.toHaveBeenCalled();
  });

  it("findCurrent throws NotFound when missing", async () => {
    neo4j.readOne.mockResolvedValue(null);

    await expect(repository.findCurrent({ id: "u-1" })).rejects.toBeInstanceOf(NotFoundException);
  });
});
