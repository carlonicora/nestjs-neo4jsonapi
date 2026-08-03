import { vi, describe, it, expect, beforeEach, afterEach } from "vitest";
import { Test, TestingModule } from "@nestjs/testing";
import { ClsService } from "nestjs-cls";
import { UserRepository } from "../user.repository";
import { Neo4jService } from "../../../../core/neo4j/services/neo4j.service";
import { SecurityService } from "../../../../core/security/services/security.service";
import { UserCypherService } from "../../services/user.cypher.service";
import { User, UserDescriptor } from "../../entities/user";
import { RoleId } from "../../../../common/constants/system.roles";

describe("UserRepository", () => {
  let repository: UserRepository;
  let mockNeo4jService: vi.Mocked<Neo4jService>;
  let mockSecurityService: vi.Mocked<SecurityService>;
  let mockClsService: vi.Mocked<ClsService>;
  let mockUserCypherService: vi.Mocked<UserCypherService>;

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
});
