import { vi, describe, it, expect, beforeEach, afterEach, MockedObject } from "vitest";
import { Test, TestingModule } from "@nestjs/testing";
import { ClsService } from "nestjs-cls";
import { DriftMigrationService } from "../drift.migration.service";
import { AppLoggingService } from "../../../../core/logging/services/logging.service";
import type { Company } from "../../../../foundations/company/entities/company";
import { CompanyRepository } from "../../../../foundations/company/repositories/company.repository";
import { CommunityRepository } from "../../../../foundations/community/repositories/community.repository";
import { CommunityDetectorService } from "../../../community.detector/services/community.detector.service";

describe("DriftMigrationService", () => {
  let service: DriftMigrationService;
  let logger: MockedObject<AppLoggingService>;
  let clsService: MockedObject<ClsService>;
  let companyRepository: MockedObject<CompanyRepository>;
  let communityRepository: MockedObject<CommunityRepository>;
  let communityDetectorService: MockedObject<CommunityDetectorService>;

  const TEST_IDS = {
    companyId1: "550e8400-e29b-41d4-a716-446655440000",
    companyId2: "660e8400-e29b-41d4-a716-446655440001",
    companyId3: "770e8400-e29b-41d4-a716-446655440002",
  };

  const MOCK_COMPANIES: Company[] = [
    { id: TEST_IDS.companyId1, name: "Company 1" } as Company,
    { id: TEST_IDS.companyId2, name: "Company 2" } as Company,
    { id: TEST_IDS.companyId3, name: "Company 3" } as Company,
  ];

  const createMockLogger = () => ({
    log: vi.fn(),
    error: vi.fn(),
    warn: vi.fn(),
    debug: vi.fn(),
    verbose: vi.fn(),
    fatal: vi.fn(),
    trace: vi.fn(),
    logWithContext: vi.fn(),
    errorWithContext: vi.fn(),
    setRequestContext: vi.fn(),
    getRequestContext: vi.fn(),
    clearRequestContext: vi.fn(),
    createChildLogger: vi.fn(),
    logHttpRequest: vi.fn(),
    logHttpError: vi.fn(),
    logBusinessEvent: vi.fn(),
    logSecurityEvent: vi.fn(),
  });

  const createMockClsService = () => ({
    run: vi.fn().mockImplementation(async (callback: () => Promise<void>) => {
      await callback();
    }),
    set: vi.fn(),
    get: vi.fn(),
  });

  const createMockCompanyRepository = () => ({
    fetchAll: vi.fn(),
    findByCompanyId: vi.fn(),
    create: vi.fn(),
    update: vi.fn(),
    delete: vi.fn(),
  });

  const createMockCommunityRepository = () => ({
    deleteAllCommunities: vi.fn(),
    createCommunity: vi.fn(),
    updateCommunityMembers: vi.fn(),
    setParentCommunity: vi.fn(),
    markAsStale: vi.fn(),
    findCommunitiesByKeyConcept: vi.fn(),
    findOrphanKeyConceptsForContent: vi.fn(),
    findCommunitiesByRelatedKeyConcepts: vi.fn(),
    addMemberToCommunity: vi.fn(),
    findCommunityById: vi.fn(),
    countByLevel: vi.fn(),
    countStaleCommunities: vi.fn(),
  });

  const createMockCommunityDetectorService = () => ({
    detectCommunities: vi.fn(),
    markAffectedCommunitiesStale: vi.fn(),
    assignKeyConceptsToCommunities: vi.fn(),
  });

  beforeEach(async () => {
    vi.clearAllMocks();

    const mockLogger = createMockLogger();
    const mockClsService = createMockClsService();
    const mockCompanyRepository = createMockCompanyRepository();
    const mockCommunityRepository = createMockCommunityRepository();
    const mockCommunityDetectorService = createMockCommunityDetectorService();

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        DriftMigrationService,
        { provide: AppLoggingService, useValue: mockLogger },
        { provide: ClsService, useValue: mockClsService },
        { provide: CompanyRepository, useValue: mockCompanyRepository },
        { provide: CommunityRepository, useValue: mockCommunityRepository },
        { provide: CommunityDetectorService, useValue: mockCommunityDetectorService },
      ],
    }).compile();

    service = module.get<DriftMigrationService>(DriftMigrationService);
    logger = module.get(AppLoggingService) as MockedObject<AppLoggingService>;
    clsService = module.get(ClsService) as MockedObject<ClsService>;
    companyRepository = module.get(CompanyRepository) as MockedObject<CompanyRepository>;
    communityRepository = module.get(CommunityRepository) as MockedObject<CommunityRepository>;
    communityDetectorService = module.get(CommunityDetectorService) as MockedObject<CommunityDetectorService>;
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  describe("constructor", () => {
    it("should create the service", () => {
      expect(service).toBeDefined();
    });
  });

  describe("migrateAll", () => {
    it("should process all companies and return migration result", async () => {
      // Arrange
      companyRepository.fetchAll.mockResolvedValue(MOCK_COMPANIES);
      communityDetectorService.detectCommunities.mockResolvedValue(undefined);

      // Act
      const result = await service.migrateAll();

      // Assert
      expect(result.totalCompanies).toBe(3);
      expect(result.processedCompanies).toBe(3);
      expect(result.failedCompanies).toEqual([]);
      expect(communityDetectorService.detectCommunities).toHaveBeenCalledTimes(3);
    });

    it("should log the start and completion of migration", async () => {
      // Arrange
      companyRepository.fetchAll.mockResolvedValue(MOCK_COMPANIES);
      communityDetectorService.detectCommunities.mockResolvedValue(undefined);

      // Act
      await service.migrateAll();

      // Assert
      expect(logger.log).toHaveBeenCalledWith("Starting DRIFT migration for all companies", "DriftMigrationService");
      expect(logger.log).toHaveBeenCalledWith("Found 3 companies to process", "DriftMigrationService");
      expect(logger.log).toHaveBeenCalledWith(
        "DRIFT migration completed: 3/3 companies processed",
        "DriftMigrationService",
      );
    });

    it("should handle empty company list", async () => {
      // Arrange
      companyRepository.fetchAll.mockResolvedValue([]);

      // Act
      const result = await service.migrateAll();

      // Assert
      expect(result.totalCompanies).toBe(0);
      expect(result.processedCompanies).toBe(0);
      expect(result.failedCompanies).toEqual([]);
      expect(communityDetectorService.detectCommunities).not.toHaveBeenCalled();
    });

    it("should track failed companies when migration fails", async () => {
      // Arrange
      companyRepository.fetchAll.mockResolvedValue(MOCK_COMPANIES);
      communityDetectorService.detectCommunities
        .mockResolvedValueOnce(undefined)
        .mockRejectedValueOnce(new Error("Migration failed"))
        .mockResolvedValueOnce(undefined);

      // Act
      const result = await service.migrateAll();

      // Assert
      expect(result.totalCompanies).toBe(3);
      expect(result.processedCompanies).toBe(2);
      expect(result.failedCompanies).toEqual([TEST_IDS.companyId2]);
      expect(logger.error).toHaveBeenCalledWith(
        `Failed to process company ${TEST_IDS.companyId2}: Migration failed`,
        "DriftMigrationService",
      );
    });

    it("should log success for each processed company", async () => {
      // Arrange
      companyRepository.fetchAll.mockResolvedValue([MOCK_COMPANIES[0]]);
      communityDetectorService.detectCommunities.mockResolvedValue(undefined);

      // Act
      await service.migrateAll();

      // Assert
      expect(logger.log).toHaveBeenCalledWith(
        `Processed company ${TEST_IDS.companyId1} (Company 1)`,
        "DriftMigrationService",
      );
    });

    it("should continue processing after a failure", async () => {
      // Arrange
      companyRepository.fetchAll.mockResolvedValue(MOCK_COMPANIES);
      communityDetectorService.detectCommunities
        .mockRejectedValueOnce(new Error("First failed"))
        .mockResolvedValueOnce(undefined)
        .mockResolvedValueOnce(undefined);

      // Act
      const result = await service.migrateAll();

      // Assert
      expect(result.processedCompanies).toBe(2);
      expect(result.failedCompanies).toEqual([TEST_IDS.companyId1]);
      expect(communityDetectorService.detectCommunities).toHaveBeenCalledTimes(3);
    });
  });

  describe("migrateCompany", () => {
    it("should run community detection within CLS context", async () => {
      // Arrange
      communityDetectorService.detectCommunities.mockResolvedValue(undefined);

      // Act
      await service.migrateCompany(TEST_IDS.companyId1);

      // Assert
      expect(clsService.run).toHaveBeenCalled();
      expect(clsService.set).toHaveBeenCalledWith("companyId", TEST_IDS.companyId1);
      expect(communityDetectorService.detectCommunities).toHaveBeenCalled();
    });

    it("should log debug messages for migration", async () => {
      // Arrange
      communityDetectorService.detectCommunities.mockResolvedValue(undefined);

      // Act
      await service.migrateCompany(TEST_IDS.companyId1);

      // Assert
      expect(logger.debug).toHaveBeenCalledWith(
        `Running community detection for company ${TEST_IDS.companyId1}`,
        "DriftMigrationService",
      );
      expect(logger.debug).toHaveBeenCalledWith(
        `Community detection completed for company ${TEST_IDS.companyId1}`,
        "DriftMigrationService",
      );
    });

    it("should propagate errors from community detection", async () => {
      // Arrange
      communityDetectorService.detectCommunities.mockRejectedValue(new Error("Detection failed"));

      // Act & Assert
      await expect(service.migrateCompany(TEST_IDS.companyId1)).rejects.toThrow("Detection failed");
    });
  });

  describe("getMigrationStatus", () => {
    it("should return status for all companies", async () => {
      // Arrange
      companyRepository.fetchAll.mockResolvedValue(MOCK_COMPANIES);
      communityRepository.countByLevel.mockResolvedValue([
        { level: 0, count: 5 },
        { level: 1, count: 3 },
      ]);
      communityRepository.countStaleCommunities.mockResolvedValue(2);

      // Act
      const result = await service.getMigrationStatus();

      // Assert
      expect(result.companies).toHaveLength(3);
      expect(result.companies[0]).toEqual({
        companyId: TEST_IDS.companyId1,
        companyName: "Company 1",
        totalCommunities: 8,
        staleCommunities: 2,
        processedCommunities: 6,
      });
    });

    it("should handle companies with no communities", async () => {
      // Arrange
      companyRepository.fetchAll.mockResolvedValue([MOCK_COMPANIES[0]]);
      communityRepository.countByLevel.mockResolvedValue([]);
      communityRepository.countStaleCommunities.mockResolvedValue(0);

      // Act
      const result = await service.getMigrationStatus();

      // Assert
      expect(result.companies[0].totalCommunities).toBe(0);
      expect(result.companies[0].staleCommunities).toBe(0);
      expect(result.companies[0].processedCommunities).toBe(0);
    });

    it("should handle null countByLevel result", async () => {
      // Arrange
      companyRepository.fetchAll.mockResolvedValue([MOCK_COMPANIES[0]]);
      communityRepository.countByLevel.mockResolvedValue(null);
      communityRepository.countStaleCommunities.mockResolvedValue(0);

      // Act
      const result = await service.getMigrationStatus();

      // Assert
      expect(result.companies[0].totalCommunities).toBe(0);
    });

    it("should handle zero stale communities", async () => {
      // Arrange
      companyRepository.fetchAll.mockResolvedValue([MOCK_COMPANIES[0]]);
      communityRepository.countByLevel.mockResolvedValue([{ level: 0, count: 5 }]);
      communityRepository.countStaleCommunities.mockResolvedValue(0);

      // Act
      const result = await service.getMigrationStatus();

      // Assert
      expect(result.companies[0].staleCommunities).toBe(0);
      expect(result.companies[0].processedCommunities).toBe(5);
    });

    it("should return empty array when no companies exist", async () => {
      // Arrange
      companyRepository.fetchAll.mockResolvedValue([]);

      // Act
      const result = await service.getMigrationStatus();

      // Assert
      expect(result.companies).toEqual([]);
    });

    it("should set up CLS context for each company", async () => {
      // Arrange
      companyRepository.fetchAll.mockResolvedValue([MOCK_COMPANIES[0]]);
      communityRepository.countByLevel.mockResolvedValue([]);
      communityRepository.countStaleCommunities.mockResolvedValue(0);

      // Act
      await service.getMigrationStatus();

      // Assert
      expect(clsService.run).toHaveBeenCalled();
      expect(clsService.set).toHaveBeenCalledWith("companyId", TEST_IDS.companyId1);
    });
  });
});
