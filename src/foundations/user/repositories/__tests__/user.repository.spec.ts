import { vi, describe, it, expect, beforeEach, afterEach } from "vitest";
import { Test, TestingModule } from "@nestjs/testing";
import { ClsService } from "nestjs-cls";
import { UserRepository } from "../user.repository";
import { Neo4jService } from "../../../../core/neo4j/services/neo4j.service";
import { UserCypherService } from "../../services/user.cypher.service";
import { User } from "../../entities/user";
import { RoleId } from "../../../../common/constants/system.roles";

describe("UserRepository", () => {
  let repository: UserRepository;
  let mockNeo4jService: vi.Mocked<Neo4jService>;
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

    mockClsService = {
      get: vi.fn(),
      set: vi.fn(),
    } as any;

    mockUserCypherService = {
      default: vi.fn().mockReturnValue(""),
    } as any;

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        UserRepository,
        { provide: Neo4jService, useValue: mockNeo4jService },
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
      expect(capturedQuery.query).toContain("MEMBER_OF");
    });
  });
});
