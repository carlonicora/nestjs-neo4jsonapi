import { AsyncLocalStorage } from "async_hooks";
import { NotFoundException } from "@nestjs/common";
import { ClsService } from "nestjs-cls";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { SystemRoles } from "../../../../common/constants/system.roles";
import { Neo4jService } from "../../../../core/neo4j/services/neo4j.service";
import type { CompanyRepository } from "../../../company/repositories/company.repository";
import { SkillCompanyAdminService } from "../skill.company-admin.service";

const COMPANY_ID = "22222222-2222-4222-8222-222222222222";
const ADMIN_ID = "33333333-3333-4333-8333-333333333333";

/**
 * SkillCompanyAdminService.inCompany runs the company skill methods for the Administrator on
 * the picked company. Proven against the real Neo4jService.initQuery (not a copy of it): inside
 * the call the query binds the picked company and carries no user membership match; outside it
 * the request's own context is unchanged.
 */
describe("SkillCompanyAdminService", () => {
  const cls = new ClsService(new AsyncLocalStorage());
  // initQuery reads only `cls` and `bindsRequestContext`; no driver is needed.
  const neo4j = Object.assign(Object.create(Neo4jService.prototype), {
    cls,
    bindsRequestContext: true,
  }) as Neo4jService;
  const companyRepository = { findByCompanyId: vi.fn() };
  let service: SkillCompanyAdminService;

  const asAdministrator = <T>(fn: () => Promise<T>) =>
    cls.run(async () => {
      cls.set("userId", ADMIN_ID);
      cls.set("roles", [SystemRoles.Administrator]);
      return fn();
    });

  beforeEach(() => {
    vi.clearAllMocks();
    companyRepository.findByCompanyId.mockResolvedValue({ id: COMPANY_ID });
    service = new SkillCompanyAdminService(cls, companyRepository as unknown as CompanyRepository);
  });

  it("without it, the picked company plus the Administrator's id would add the membership match", async () => {
    await asAdministrator(async () => {
      cls.set("companyId", COMPANY_ID);
      expect(neo4j.initQuery().query).toContain("(currentUser:User {id: $currentUserId})-[:BELONGS_TO]->(company)");
    });
  });

  it("binds the picked company and no user membership match for the service call", async () => {
    const result = await asAdministrator(() =>
      service.inCompany({
        companyId: COMPANY_ID,
        run: async () => {
          const query = neo4j.initQuery();
          return { query, roles: cls.get("roles") };
        },
      }),
    );

    expect(companyRepository.findByCompanyId).toHaveBeenCalledWith({ companyId: COMPANY_ID });
    expect(result.query.queryParams.companyId).toBe(COMPANY_ID);
    expect(result.query.queryParams.currentUserId).toBeNull();
    expect(result.query.query).toContain("MATCH (company:Company {id: $companyId})");
    expect(result.query.query).not.toContain("currentUser");
    expect(result.query.query).not.toContain("BELONGS_TO");
    // The Administrator's roles stay readable (the audit service reads them).
    expect(result.roles).toEqual([SystemRoles.Administrator]);
  });

  it("leaves the request's own context untouched", async () => {
    await asAdministrator(async () => {
      await service.inCompany({ companyId: COMPANY_ID, run: async () => undefined });
      expect(cls.get("companyId")).toBeUndefined();
      expect(cls.get("userId")).toBe(ADMIN_ID);
      const query = neo4j.initQuery();
      expect(query.queryParams.companyId).toBeNull();
      expect(query.queryParams.currentUserId).toBe(ADMIN_ID);
    });
  });

  it("answers 404 for an unknown company and never runs the call", async () => {
    companyRepository.findByCompanyId.mockResolvedValue(null);
    const run = vi.fn();
    await expect(asAdministrator(() => service.inCompany({ companyId: COMPANY_ID, run }))).rejects.toBeInstanceOf(
      NotFoundException,
    );
    expect(run).not.toHaveBeenCalled();
  });

  it("passes the call's error through", async () => {
    await expect(
      asAdministrator(() =>
        service.inCompany({
          companyId: COMPANY_ID,
          run: async () => {
            throw new NotFoundException();
          },
        }),
      ),
    ).rejects.toBeInstanceOf(NotFoundException);
  });
});
