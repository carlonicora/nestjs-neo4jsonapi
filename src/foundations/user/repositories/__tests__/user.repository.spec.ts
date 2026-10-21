import { vi, describe, it, expect, beforeEach, afterEach, type Mocked } from "vitest";
import { Test, TestingModule } from "@nestjs/testing";
import { ClsService } from "nestjs-cls";
import { UserRepository } from "../user.repository";
import { Neo4jService } from "../../../../core/neo4j/services/neo4j.service";
import { SecurityService } from "../../../../core/security/services/security.service";
import { UserCypherService } from "../../services/user.cypher.service";
import { User, UserDescriptor } from "../../entities/user";
import { RoleId } from "../../../../common/constants/system.roles";

const SCOPED_USER_MATCH =
  /MATCH \(company:Company \{id: \$companyId\}\)\s*MATCH \(user:User \{id: \$userId\}\)-\[:BELONGS_TO\]->\(company\)/;

describe("UserRepository", () => {
  let repository: UserRepository;
  let mockNeo4jService: Mocked<Neo4jService>;
  let mockSecurityService: Mocked<SecurityService>;
  let mockClsService: Mocked<ClsService>;
  let mockUserCypherService: Mocked<UserCypherService>;

  const TEST_IDS = {
    companyId: "company-test-123",
    userId: "user-test-456",
    adminUserId: "admin-user-789",
  };

  const MOCK_ADMIN_USER: User = {
    id: TEST_IDS.adminUserId,
    type: "users",
    name: "Admin User",
    email: "admin@test.com",
    isActive: true,
    isDeleted: false,
    role: [{ id: RoleId.CompanyAdministrator, name: "Company Administrator" }],
  } as User;

  beforeEach(async () => {
    mockNeo4jService = {
      initQuery: vi.fn().mockReturnValue({
        query: "",
        queryParams: {},
      }),
      readOne: vi.fn(),
      readMany: vi.fn(),
      writeOne: vi.fn(),
      read: vi.fn(),
    } as any;

    mockSecurityService = {
      userHasAccess: vi.fn().mockResolvedValue(true),
    } as any;

    mockClsService = {
      get: vi.fn(),
      set: vi.fn(),
      has: vi.fn().mockReturnValue(false),
    } as any;

    mockUserCypherService = {
      default: vi.fn().mockReturnValue(""),
    } as any;

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        UserRepository,
        { provide: Neo4jService, useValue: mockNeo4jService },
        { provide: SecurityService, useValue: mockSecurityService },
        { provide: ClsService, useValue: mockClsService },
        { provide: UserCypherService, useValue: mockUserCypherService },
      ],
    }).compile();

    repository = module.get<UserRepository>(UserRepository);
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  describe("findAdminsByCompanyId", () => {
    it("should return admins for company with CompanyAdministrator role", async () => {
      const mockAdmins = [MOCK_ADMIN_USER];
      mockNeo4jService.readMany.mockResolvedValue(mockAdmins);

      const result = await repository.findAdminsByCompanyId({ companyId: TEST_IDS.companyId });

      expect(mockNeo4jService.initQuery).toHaveBeenCalled();
      expect(mockNeo4jService.readMany).toHaveBeenCalled();
      expect(result).toEqual(mockAdmins);
    });

    it("should return empty array when no admins found", async () => {
      mockNeo4jService.readMany.mockResolvedValue([]);

      const result = await repository.findAdminsByCompanyId({ companyId: TEST_IDS.companyId });

      expect(result).toEqual([]);
    });

    it("should include correct query parameters", async () => {
      let capturedQuery: any;
      mockNeo4jService.initQuery.mockReturnValue({
        query: "",
        queryParams: {},
      });
      mockNeo4jService.readMany.mockImplementation(async (query: any) => {
        capturedQuery = query;
        return [];
      });

      await repository.findAdminsByCompanyId({ companyId: TEST_IDS.companyId });

      expect(capturedQuery.queryParams.companyId).toBe(TEST_IDS.companyId);
      expect(capturedQuery.queryParams.companyAdminRoleId).toBe(RoleId.CompanyAdministrator);
    });

    it("should use fetchAll: true option", async () => {
      mockNeo4jService.readMany.mockResolvedValue([]);

      await repository.findAdminsByCompanyId({ companyId: TEST_IDS.companyId });

      expect(mockNeo4jService.initQuery).toHaveBeenCalledWith(
        expect.objectContaining({
          fetchAll: true,
        }),
      );
    });

    it("should filter out deleted users in query", async () => {
      let capturedQuery: any;
      mockNeo4jService.initQuery.mockReturnValue({
        query: "",
        queryParams: {},
      });
      mockNeo4jService.readMany.mockImplementation(async (query: any) => {
        capturedQuery = query;
        return [];
      });

      await repository.findAdminsByCompanyId({ companyId: TEST_IDS.companyId });

      expect(capturedQuery.query).toContain("isDeleted: false");
    });

    it("should return multiple admins when company has multiple", async () => {
      const mockAdmins = [
        { ...MOCK_ADMIN_USER, id: "admin-1", email: "admin1@test.com" },
        { ...MOCK_ADMIN_USER, id: "admin-2", email: "admin2@test.com" },
        { ...MOCK_ADMIN_USER, id: "admin-3", email: "admin3@test.com" },
      ] as User[];
      mockNeo4jService.readMany.mockResolvedValue(mockAdmins);

      const result = await repository.findAdminsByCompanyId({ companyId: TEST_IDS.companyId });

      expect(result).toHaveLength(3);
    });

    it("should query for users with BELONGS_TO relationship to company", async () => {
      let capturedQuery: any;
      mockNeo4jService.initQuery.mockReturnValue({
        query: "",
        queryParams: {},
      });
      mockNeo4jService.readMany.mockImplementation(async (query: any) => {
        capturedQuery = query;
        return [];
      });

      await repository.findAdminsByCompanyId({ companyId: TEST_IDS.companyId });

      expect(capturedQuery.query).toContain("BELONGS_TO");
      expect(capturedQuery.query).toContain("HAS_MEMBERSHIP");
      expect(capturedQuery.query).toContain("IN_COMPANY");
      expect(capturedQuery.query).toContain("HAS_ROLE");
    });
  });

  describe("findMany with a search term", () => {
    it("scopes the fulltext hits without a bare pattern expression on `company`", async () => {
      // initQuery binds `company` only when a company is in context. A bare
      // pattern expression `(node)-[:BELONGS_TO]->(company)` is therefore a
      // Neo4j 42001 syntax error for a platform administrator (no company), and
      // GET /users?search= answered 500. The scoping must use the same
      // `$companyId IS NULL OR EXISTS { ... }` shape as UserCypherService.default().
      mockNeo4jService.readMany.mockResolvedValue([]);
      expect(UserDescriptor.fulltextIndexName, "User must have a fulltext index for this branch").toBeTruthy();

      await repository.findMany({ term: "member" });

      const query = mockNeo4jService.readMany.mock.calls[0][0].query as string;
      expect(query).toContain(`db.index.fulltext.queryNodes("${UserDescriptor.fulltextIndexName}", $term)`);
      expect(query).toContain("$companyId IS NULL");
      expect(query).toMatch(/OR EXISTS \{\s*MATCH \(node\)-\[:BELONGS_TO\]->\(company\)\s*\}/);
      expect(query).not.toMatch(/WHERE \(node\)-\[:BELONGS_TO\]->\(company\)/);
    });
  });

  describe("model resolution", () => {
    it("should expose the package descriptor as the inherited AbstractRepository member", () => {
      expect(repository["descriptor"]).toBe(UserDescriptor);
    });

    it("should pass this.descriptor.model as the serialiser", async () => {
      mockNeo4jService.readMany.mockResolvedValue([]);

      await repository.findMany({});

      expect(mockNeo4jService.initQuery).toHaveBeenCalledWith(
        expect.objectContaining({
          serialiser: UserDescriptor.model,
        }),
      );
    });

    it("should resolve the model on every read path, not only findMany", async () => {
      mockNeo4jService.readMany.mockResolvedValue([]);

      await repository.findAdminsByCompanyId({ companyId: TEST_IDS.companyId });

      expect(mockNeo4jService.initQuery).toHaveBeenCalledWith(
        expect.objectContaining({
          serialiser: UserDescriptor.model,
          fetchAll: true,
        }),
      );
    });

    it("should let a subclass override the model that every package-own method uses", async () => {
      const EXTENDED_DESCRIPTOR = {
        ...UserDescriptor,
        model: { ...UserDescriptor.model, isExtended: true },
      } as any;

      // Mirrors what an application's ExtendedUserRepository writes: an
      // initialised class-field re-declaration of `descriptor`.
      class ExtendedUserRepository extends UserRepository {
        protected readonly descriptor = EXTENDED_DESCRIPTOR;
      }

      const extended = new ExtendedUserRepository(
        mockNeo4jService as any,
        mockSecurityService as any,
        mockClsService as any,
        mockUserCypherService as any,
      );

      mockNeo4jService.readMany.mockResolvedValue([]);

      await extended.findMany({});

      expect(mockNeo4jService.initQuery).toHaveBeenCalledWith(
        expect.objectContaining({
          serialiser: EXTENDED_DESCRIPTOR.model,
        }),
      );
    });
  });

  describe("onModuleInit", () => {
    it("should create the descriptor constraints/indexes and the user_email constraint", async () => {
      mockNeo4jService.read.mockResolvedValue({ records: [] } as any);

      await repository.onModuleInit();

      const queries = mockNeo4jService.writeOne.mock.calls.map((call: any[]) => call[0].query);

      expect(
        queries.some((q: string) =>
          q.includes("CREATE CONSTRAINT user_id IF NOT EXISTS FOR (user:User) REQUIRE user.id IS UNIQUE"),
        ),
      ).toBe(true);
      expect(
        queries.some((q: string) =>
          q.includes("CREATE CONSTRAINT user_email IF NOT EXISTS FOR (user:User) REQUIRE user.email IS UNIQUE"),
        ),
      ).toBe(true);

      const fulltext = queries.find((q: string) => q.includes("CREATE FULLTEXT INDEX"));
      expect(fulltext).toBeDefined();
      expect(fulltext).not.toContain("n.`password`");
      expect(fulltext).not.toContain("n.`code`");
      expect(fulltext).toContain("n.`email`");
    });
  });

  describe("putUser", () => {
    const putParams = {
      isAdmin: true,
      userId: TEST_IDS.userId,
      email: "User@Test.com",
      name: "Updated Name",
      roles: [],
    };

    function writtenQuery(): string {
      return mockNeo4jService.writeOne.mock.calls[0][0].query;
    }

    it("keeps the company scoping when a company is in context", async () => {
      mockNeo4jService.initQuery.mockReturnValue({ query: "", queryParams: { companyId: TEST_IDS.companyId } } as any);

      await repository.putUser({ ...putParams, isSelf: true });

      expect(writtenQuery()).toContain("MATCH (company:Company {id: $companyId})");
    });

    it("keeps the company scoping when editing someone else, even with no company in context", async () => {
      // The company match is what confines a CompanyAdministrator to their own
      // company — it must never be dropped for another user's record.
      await repository.putUser({ ...putParams, isSelf: false });

      expect(writtenQuery()).toContain("MATCH (company:Company {id: $companyId})");
    });

    it("ties another user to the company through BELONGS_TO (no cross-tenant takeover)", async () => {
      // Matching the company alone left `user` free: a CompanyAdministrator could
      // rewrite the email/password of a user in any other company by id.
      mockNeo4jService.initQuery.mockReturnValue({ query: "", queryParams: { companyId: TEST_IDS.companyId } } as any);

      await repository.putUser({ ...putParams, isSelf: false });

      const query = writtenQuery();
      expect(query).toMatch(SCOPED_USER_MATCH);
      expect(query).not.toMatch(/MATCH \(user:User \{id: \$userId\}\)\s*SET/);
    });

    it("drops the company match for a self-edit with no company, so the SET actually runs", async () => {
      // A user can have no company (the seeded Administrator has none). With a
      // null $companyId the company match resolves to zero rows, so the SET
      // silently never ran while the endpoint still answered 200.
      await repository.putUser({ ...putParams, isSelf: true });

      const query = writtenQuery();
      expect(query).not.toContain("MATCH (company:Company {id: $companyId})");
      expect(query).toContain("MATCH (user:User {id: $userId})");
      expect(query).toContain("user.name = $name");
      // Roles are company-scoped: without a matched `company` the role block
      // would reference an undefined variable.
      expect(query).not.toContain("IN_COMPANY");
    });
  });

  describe("company-scoped writes by id", () => {
    function written(): { query: string; queryParams: Record<string, unknown> } {
      const { query, queryParams } = mockNeo4jService.writeOne.mock.calls[0][0];
      return { query: query ?? "", queryParams };
    }

    beforeEach(() => {
      mockNeo4jService.initQuery.mockReturnValue({
        query: "PREAMBLE",
        queryParams: { companyId: TEST_IDS.companyId, currentUserId: TEST_IDS.adminUserId },
      } as any);
    });

    it("deleteUser binds the user to $companyId, not to any company", async () => {
      await repository.deleteUser({ userId: TEST_IDS.userId });

      const { query, queryParams } = written();
      expect(query).toMatch(SCOPED_USER_MATCH);
      expect(query).not.toMatch(/MATCH \(company:Company\)\s/);
      expect(query).toContain("SET user.isDeleted = true");
      expect(queryParams).toMatchObject({ userId: TEST_IDS.userId, companyId: TEST_IDS.companyId });
    });

    it("deleteUser reaches any user only for a platform administrator", async () => {
      await repository.deleteUser({ userId: TEST_IDS.userId, isPlatformAdmin: true });

      const { query } = written();
      expect(query).toContain("MATCH (user:User {id: $userId})");
      expect(query).not.toContain("BELONGS_TO");
    });

    it("reactivate is company-scoped unless the caller is a platform administrator", async () => {
      await repository.reactivate({ userId: TEST_IDS.userId });
      expect(written().query).toMatch(SCOPED_USER_MATCH);

      mockNeo4jService.writeOne.mockClear();
      await repository.reactivate({ userId: TEST_IDS.userId, isPlatformAdmin: true });
      expect(written().query).not.toContain("BELONGS_TO");
    });

    it("patchRate is company-scoped unless the caller is a platform administrator", async () => {
      await repository.patchRate({ userId: TEST_IDS.userId, rate: 10 });
      expect(written().query).toMatch(SCOPED_USER_MATCH);

      mockNeo4jService.writeOne.mockClear();
      await repository.patchRate({ userId: TEST_IDS.userId, rate: 10, isPlatformAdmin: true });
      expect(written().query).not.toContain("BELONGS_TO");
    });

    it("patchAvatar is company-scoped for another user and by id for self", async () => {
      await repository.patchAvatar({ userId: TEST_IDS.userId, avatar: "a.png" });
      expect(written().query).toMatch(SCOPED_USER_MATCH);

      mockNeo4jService.writeOne.mockClear();
      await repository.patchAvatar({ userId: TEST_IDS.userId, avatar: "a.png", isSelf: true });
      expect(written().query).toContain("MATCH (user:User {id: $userId})");
      expect(written().query).not.toContain("BELONGS_TO");
    });

    it("assigns the query (no initQuery preamble), so the explicit company match is the only scope", async () => {
      // The preamble also requires the caller to BELONG_TO the company, which a
      // platform administrator acting through x-companyid does not.
      await repository.deleteUser({ userId: TEST_IDS.userId });
      expect(written().query).not.toContain("PREAMBLE");
    });

    it("with no company in context the scoped match binds $companyId = null and reaches no user", async () => {
      mockNeo4jService.initQuery.mockReturnValue({ query: "", queryParams: { companyId: null } } as any);

      await repository.deleteUser({ userId: TEST_IDS.userId });

      const { query, queryParams } = written();
      expect(query).toContain("MATCH (company:Company {id: $companyId})");
      expect(queryParams.companyId).toBeNull();
    });
  });

  describe("removeUserFromRole", () => {
    it("removes a company role only from a user who BELONGS_TO the request company", async () => {
      await repository.removeUserFromRole({ userId: TEST_IDS.userId, roleId: "role-1" });

      const { query, queryParams } = mockNeo4jService.writeOne.mock.calls[0][0];
      expect(query).toContain("(user)-[:BELONGS_TO]->(:Company {id: $companyId})");
      expect(query).toContain("(rm_ms)-[:IN_COMPANY]->(:Company {id: $companyId})");
      expect(query).toContain("$roleId = $administratorRoleId AND NOT (rm_ms)-[:IN_COMPANY]->(:Company)");
      expect(queryParams).toMatchObject({ roleId: "role-1", administratorRoleId: RoleId.Administrator });
    });
  });

  describe("patchLanguage", () => {
    it("writes the language and updatedAt with parameterised values", async () => {
      await repository.patchLanguage({ userId: TEST_IDS.userId, language: "it" });

      const written = mockNeo4jService.writeOne.mock.calls[0][0];
      expect(written.query).toContain("WITH currentUser AS user");
      expect(written.query).toContain("WHERE user.id = $userId");
      expect(written.query).toMatch(/SET user\.language = \$language,\s+user\.updatedAt = datetime\(\)/);
      expect(written.queryParams).toEqual({ userId: TEST_IDS.userId, language: "it" });
    });
  });

  describe("setSignupSource", () => {
    it("merges only the provided keys as one map parameter, nothing interpolated", async () => {
      await repository.setSignupSource({
        userId: TEST_IDS.userId,
        source: { sourceRef: "discord-embed", sourceUtmSource: "reddit" },
      });

      const written = mockNeo4jService.writeOne.mock.calls[0][0];
      expect(written.query).toContain("MATCH (user:User {id: $userId})");
      expect(written.query).toContain("SET user += $source");
      expect(written.query).not.toContain("discord-embed");
      expect(written.query).not.toContain("reddit");
      expect(written.queryParams).toEqual({
        userId: TEST_IDS.userId,
        source: { sourceRef: "discord-embed", sourceUtmSource: "reddit" },
      });
    });

    it("ignores keys outside the whitelist and writes nothing when no key is left", async () => {
      await repository.setSignupSource({
        userId: TEST_IDS.userId,
        source: { "name = 'x'": "y" } as any,
      });

      expect(mockNeo4jService.writeOne).not.toHaveBeenCalled();
    });
  });

  describe("findForLanguage", () => {
    it("reads the bare user node by id through readOne", async () => {
      mockNeo4jService.readOne.mockResolvedValue({ id: TEST_IDS.userId, language: "it" });

      const user = await repository.findForLanguage({ userId: TEST_IDS.userId });

      const read = mockNeo4jService.readOne.mock.calls[0][0];
      expect(read.query).toContain("MATCH (user:User {id: $userId})");
      expect(read.query).toContain("RETURN user");
      expect(read.queryParams).toEqual({ userId: TEST_IDS.userId });
      expect(user?.language).toBe("it");
    });

    it("reads by lower-cased email", async () => {
      mockNeo4jService.readOne.mockResolvedValue(null);

      const user = await repository.findForLanguage({ email: "A@B.C" });

      const read = mockNeo4jService.readOne.mock.calls[0][0];
      expect(read.query).toContain("WHERE toLower(user.email) = $email");
      expect(read.queryParams).toEqual({ email: "a@b.c" });
      expect(user).toBeUndefined();
    });
  });
});
