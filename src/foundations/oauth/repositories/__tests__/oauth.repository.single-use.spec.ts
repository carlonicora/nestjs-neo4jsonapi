import { describe, it, expect, beforeEach, vi } from "vitest";
import { ClsService } from "nestjs-cls";
import { OAuthRepository } from "../oauth.repository";
import { Neo4jService } from "../../../../core/neo4j/services/neo4j.service";
import { EntityFactory } from "../../../../core/neo4j/factories/entity.factory";
import { OAuthAuthorizationCodeModel } from "../../entities/oauth.authorization.code.model";

/**
 * F5: `markAuthorizationCodeUsed` used `writeOne` without a serialiser, which
 * returns null whether or not a row matched, so the method always returned
 * true and a code could be redeemed twice. These specs run the REAL
 * `Neo4jService.initQuery` / `writeOne` with only the driver-level `write`
 * stubbed, so the return shape is the real one.
 */
describe("OAuthRepository.markAuthorizationCodeUsed (real writeOne)", () => {
  let repository: OAuthRepository;
  let write: ReturnType<typeof vi.fn>;
  let createGraphList: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    write = vi.fn();
    createGraphList = vi
      .fn()
      .mockImplementation(({ records }: { records: unknown[] }) =>
        records.map(() => ({ id: "code-id", isUsed: true })),
      );

    const neo4j = Object.create(Neo4jService.prototype) as Neo4jService;
    Object.assign(neo4j, {
      write,
      entityFactory: { createGraphList } as unknown as EntityFactory,
      cls: { has: vi.fn().mockReturnValue(false), get: vi.fn() } as unknown as ClsService,
      bindsRequestContext: true,
    });
    repository = new OAuthRepository(neo4j);
  });

  it("returns true for the first use (one row updated)", async () => {
    write.mockResolvedValue({ records: [{}] });

    await expect(repository.markAuthorizationCodeUsed("hash")).resolves.toBe(true);
    expect(createGraphList).toHaveBeenCalledWith(expect.objectContaining({ model: OAuthAuthorizationCodeModel }));
  });

  it("returns false on reuse (zero rows: the code was already used)", async () => {
    write.mockResolvedValueOnce({ records: [{}] }).mockResolvedValueOnce({ records: [] });

    await expect(repository.markAuthorizationCodeUsed("hash")).resolves.toBe(true);
    await expect(repository.markAuthorizationCodeUsed("hash")).resolves.toBe(false);
  });

  it("takes the write lock before reading isUsed, then flips it only when false", async () => {
    write.mockResolvedValue({ records: [] });

    await repository.markAuthorizationCodeUsed("hash");

    const [query, params] = write.mock.calls[0];
    expect(params).toMatchObject({ codeHash: "hash" });
    const lock = query.indexOf("SET oauthauthorizationcode._lock = true");
    const check = query.indexOf("WHERE oauthauthorizationcode.isUsed = false");
    const flip = query.indexOf("SET oauthauthorizationcode.isUsed = true");
    expect(lock).toBeGreaterThan(-1);
    expect(lock).toBeLessThan(check);
    expect(check).toBeLessThan(flip);
    expect(query).toContain("RETURN oauthauthorizationcode");
  });
});

describe("OAuthRepository.isTokenSubjectAuthorised", () => {
  let repository: OAuthRepository;
  let readCount: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    readCount = vi.fn();
    const neo4j = {
      initQuery: vi.fn().mockReturnValue({ query: "", queryParams: { companyId: "cls-company" } }),
      readCount,
    } as unknown as Neo4jService;
    repository = new OAuthRepository(neo4j);
  });

  it("requires a non-deleted, active user who BELONGS_TO the token's company", async () => {
    readCount.mockResolvedValue(1);

    await expect(repository.isTokenSubjectAuthorised({ userId: "u1", companyId: "c1" })).resolves.toBe(true);

    const [query, params] = readCount.mock.calls[0];
    expect(query).toContain("MATCH (oauthUser:User {id: $userId})");
    expect(query).toContain("coalesce(oauthUser.isDeleted, false) = false");
    expect(query).toContain("oauthUser.isActive = true");
    expect(query).toMatch(/\(oauthUser\)-\[:BELONGS_TO\]->\(:Company \{id: \$tokenCompanyId\}\)/);
    // Bound to the token's company, never to the request's CLS company.
    expect(params).toMatchObject({ userId: "u1", tokenCompanyId: "c1" });
  });

  it("returns false when no such user matches (deleted, inactive or removed from the company)", async () => {
    readCount.mockResolvedValue(0);

    await expect(repository.isTokenSubjectAuthorised({ userId: "u1", companyId: "c1" })).resolves.toBe(false);
  });

  it("only checks the user for a token without a company", async () => {
    readCount.mockResolvedValue(1);

    await repository.isTokenSubjectAuthorised({ userId: "u1", companyId: null });

    expect(readCount.mock.calls[0][1]).toMatchObject({ tokenCompanyId: null });
    expect(readCount.mock.calls[0][0]).toContain("$tokenCompanyId IS NULL OR");
  });
});
