import { vi, describe, it, expect, beforeEach, afterEach, MockedObject } from "vitest";
import { BadRequestException } from "@nestjs/common";
import { Test, TestingModule } from "@nestjs/testing";

// Mock neo4j-driver
const mockTxRun = vi.fn();
const mockTx = {
  run: mockTxRun,
};

const mockSession = {
  executeRead: vi.fn((fn) => fn(mockTx)),
  executeWrite: vi.fn((fn) => fn(mockTx)),
  beginTransaction: vi.fn(() => ({
    run: mockTxRun,
    commit: vi.fn(),
    rollback: vi.fn(),
  })),
  close: vi.fn(),
};

const mockDriver = {
  session: vi.fn(() => mockSession),
  close: vi.fn(),
};

vi.mock("neo4j-driver", () => ({
  driver: vi.fn(() => mockDriver),
  auth: {
    basic: vi.fn(() => ({})),
  },
}));

// Mock config
vi.mock("../../../../config/base.config", () => ({
  baseConfig: {
    neo4j: {
      uri: "bolt://localhost:7687",
      username: "neo4j",
      password: "password",
      database: "neo4j",
    },
  },
}));

import { Neo4jService, QueryType } from "../neo4j.service";
import { EntityFactory } from "../../factories/entity.factory";
import { ClsService } from "nestjs-cls";
import { AppLoggingService } from "../../../logging/services/logging.service";
import { DataModelInterface } from "../../../../common/interfaces/datamodel.interface";

describe("Neo4jService", () => {
  let service: Neo4jService;
  let entityFactory: MockedObject<EntityFactory>;
  let clsService: MockedObject<ClsService>;
  let logger: MockedObject<AppLoggingService>;

  const TEST_IDS = {
    companyId: "550e8400-e29b-41d4-a716-446655440000",
    userId: "660e8400-e29b-41d4-a716-446655440001",
  };

  const createMockEntityFactory = () => ({
    createGraphList: vi.fn(),
  });

  const createMockClsService = () => ({
    has: vi.fn(),
    get: vi.fn(),
    set: vi.fn(),
  });

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

  const createMockSerialiser = (): DataModelInterface<any> => ({
    nodeName: "TestEntity",
    jsonapiType: "test-entities",
    mapper: vi.fn(),
    attributes: {},
  });

  beforeEach(async () => {
    vi.clearAllMocks();

    const mockEntityFactory = createMockEntityFactory();
    const mockClsService = createMockClsService();
    const mockLogger = createMockLogger();

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        Neo4jService,
        { provide: EntityFactory, useValue: mockEntityFactory },
        { provide: ClsService, useValue: mockClsService },
        { provide: AppLoggingService, useValue: mockLogger },
      ],
    }).compile();

    service = module.get<Neo4jService>(Neo4jService);
    entityFactory = module.get(EntityFactory) as MockedObject<EntityFactory>;
    clsService = module.get(ClsService) as MockedObject<ClsService>;
    logger = module.get(AppLoggingService) as MockedObject<AppLoggingService>;
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  describe("constructor", () => {
    it("should create the service with driver configured", () => {
      expect(service).toBeDefined();
      expect(service.getDriver()).toBe(mockDriver);
    });
  });

  describe("initQuery", () => {
    it("should initialize query with companyId and userId from CLS when available", () => {
      // Arrange
      clsService.has.mockImplementation((key: string) => key === "companyId" || key === "userId");
      clsService.get.mockImplementation((key: string) => {
        if (key === "companyId") return TEST_IDS.companyId;
        if (key === "userId") return TEST_IDS.userId;
        return null;
      });

      // Act
      const result = service.initQuery();

      // Assert
      expect(result.queryParams.companyId).toBe(TEST_IDS.companyId);
      expect(result.queryParams.currentUserId).toBe(TEST_IDS.userId);
      expect(result.query).toContain("MATCH (company:Company {id: $companyId})");
      expect(result.query).toContain("MATCH (currentUser:User {id: $currentUserId})-[:BELONGS_TO]->(company)");
    });

    it("should return null for companyId and userId when not in CLS", () => {
      // Arrange
      clsService.has.mockReturnValue(false);

      // Act
      const result = service.initQuery();

      // Assert
      expect(result.queryParams.companyId).toBeNull();
      expect(result.queryParams.currentUserId).toBeNull();
    });

    it("should include cursor and serialiser from params", () => {
      // Arrange
      clsService.has.mockReturnValue(false);
      const cursor = { cursor: "10", take: 25 };
      const serialiser = createMockSerialiser();

      // Act
      const result = service.initQuery({ cursor, serialiser, fetchAll: true });

      // Assert
      expect(result.cursor).toBe(cursor);
      expect(result.serialiser).toBe(serialiser);
      expect(result.fetchAll).toBe(true);
    });

    it("should handle userId without companyId", () => {
      // Arrange
      clsService.has.mockImplementation((key: string) => key === "userId");
      clsService.get.mockImplementation((key: string) => {
        if (key === "userId") return TEST_IDS.userId;
        return null;
      });

      // Act
      const result = service.initQuery();

      // Assert
      expect(result.queryParams.companyId).toBeNull();
      expect(result.queryParams.currentUserId).toBe(TEST_IDS.userId);
      expect(result.query).toContain("MATCH (currentUser:User {id: $currentUserId})");
      expect(result.query).not.toContain("BELONGS_TO");
    });
  });

  describe("getConfig", () => {
    it("should return neo4j config with provided params", () => {
      // Act
      const result = service.getConfig({
        indexName: "testIndex",
        nodeLabel: "TestNode",
        textNodeProperty: "name",
      });

      // Assert
      expect(result).toEqual({
        url: "bolt://localhost:7687",
        username: "neo4j",
        password: "password",
        database: "neo4j",
        indexName: "testIndex",
        nodeLabel: "TestNode",
        textNodeProperty: "name",
        embeddingNodeProperty: "embedding",
        searchType: "vector",
        createdIndex: true,
      });
    });
  });

  describe("getDriver", () => {
    it("should return the driver instance", () => {
      // Act
      const driver = service.getDriver();

      // Assert
      expect(driver).toBe(mockDriver);
    });
  });

  describe("readOne", () => {
    it("should return single entity when record exists", async () => {
      // Arrange
      const serialiser = createMockSerialiser();
      const mockEntity = { id: TEST_IDS.companyId, name: "Test" };
      mockTxRun.mockResolvedValue({ records: [{ data: "test" }] });
      entityFactory.createGraphList.mockReturnValue([mockEntity]);

      const params: QueryType<any> = {
        query: "MATCH (n) RETURN n",
        queryParams: {},
        serialiser,
      };

      // Act
      const result = await service.readOne(params);

      // Assert
      expect(result).toEqual(mockEntity);
      expect(entityFactory.createGraphList).toHaveBeenCalledWith({
        model: serialiser,
        records: [{ data: "test" }],
      });
    });

    it("should return null when no records found", async () => {
      // Arrange
      mockTxRun.mockResolvedValue({ records: [] });

      const params: QueryType<any> = {
        query: "MATCH (n) RETURN n",
        queryParams: {},
      };

      // Act
      const result = await service.readOne(params);

      // Assert
      expect(result).toBeNull();
    });

    it("should return null when entity factory returns empty array", async () => {
      // Arrange
      const serialiser = createMockSerialiser();
      mockTxRun.mockResolvedValue({ records: [{ data: "test" }] });
      entityFactory.createGraphList.mockReturnValue([]);

      const params: QueryType<any> = {
        query: "MATCH (n) RETURN n",
        queryParams: {},
        serialiser,
      };

      // Act
      const result = await service.readOne(params);

      // Assert
      expect(result).toBeNull();
    });
  });

  describe("readManyWithoutCount", () => {
    it("should return entities without count", async () => {
      // Arrange
      const serialiser = createMockSerialiser();
      const mockEntities = [
        { id: "1", name: "Test1" },
        { id: "2", name: "Test2" },
      ];
      mockTxRun.mockResolvedValue({ records: [{ data: "test" }] });
      entityFactory.createGraphList.mockReturnValue(mockEntities);

      const params: QueryType<any> = {
        query: "MATCH (n) RETURN n",
        queryParams: {},
        serialiser,
      };

      // Act
      const result = await service.readManyWithoutCount(params);

      // Assert
      expect(result).toEqual(mockEntities);
    });

    it("should handle cursor pagination with cursor value", async () => {
      // Arrange
      const serialiser = createMockSerialiser();
      const mockEntities = [{ id: "1", name: "Test" }];
      mockTxRun.mockResolvedValue({ records: [{}] });
      entityFactory.createGraphList.mockReturnValue(mockEntities);

      const params: QueryType<any> = {
        query: "MATCH (n) RETURN n {CURSOR}",
        queryParams: {},
        serialiser,
        cursor: { cursor: "10", take: 25 },
        fetchAll: false,
      };

      // Act
      await service.readManyWithoutCount(params);

      // Assert
      expect(params.queryParams.cursor).toBe("10");
      expect(params.queryParams.take).toBe(25);
    });

    it("should handle cursor pagination without cursor value", async () => {
      // Arrange
      const serialiser = createMockSerialiser();
      mockTxRun.mockResolvedValue({ records: [{}] });
      entityFactory.createGraphList.mockReturnValue([]);

      const params: QueryType<any> = {
        query: "MATCH (n) RETURN n {CURSOR}",
        queryParams: {},
        serialiser,
        cursor: { take: 25 },
        fetchAll: false,
      };

      // Act
      await service.readManyWithoutCount(params);

      // Assert
      expect(params.queryParams.take).toBe(25);
    });

    it("should use default take value of 26", async () => {
      // Arrange
      const serialiser = createMockSerialiser();
      mockTxRun.mockResolvedValue({ records: [{}] });
      entityFactory.createGraphList.mockReturnValue([]);

      const params: QueryType<any> = {
        query: "MATCH (n) RETURN n {CURSOR}",
        queryParams: {},
        serialiser,
        cursor: {},
        fetchAll: false,
      };

      // Act
      await service.readManyWithoutCount(params);

      // Assert
      expect(params.queryParams.take).toBe(26);
    });

    it("should remove cursor placeholder when fetchAll is true", async () => {
      // Arrange
      const serialiser = createMockSerialiser();
      mockTxRun.mockResolvedValue({ records: [{}] });
      entityFactory.createGraphList.mockReturnValue([]);

      const params: QueryType<any> = {
        query: "MATCH (n) RETURN n {CURSOR}",
        queryParams: {},
        serialiser,
        fetchAll: true,
      };

      // Act
      await service.readManyWithoutCount(params);

      // Assert
      expect(params.query).not.toContain("{CURSOR}");
    });

    it("should log and rethrow error on failure", async () => {
      // Arrange
      const error = new Error("Database error");
      mockTxRun.mockRejectedValue(error);

      const params: QueryType<any> = {
        query: "MATCH (n) RETURN n",
        queryParams: {},
      };

      // Act & Assert
      await expect(service.readManyWithoutCount(params)).rejects.toThrow("Neo4j Read Error: Database error");
      expect(logger.error).toHaveBeenCalled();
    });
  });

  describe("readMany", () => {
    it("should return entities with count query when serialiser has nodeName", async () => {
      // Arrange
      const serialiser = createMockSerialiser();
      const mockEntities = [{ id: "1", name: "Test" }];
      const mockCountRecord = {
        get: vi.fn().mockReturnValue({ toNumber: () => 100 }),
      };
      mockTxRun
        .mockResolvedValueOnce({ records: [{}] }) // data query
        .mockResolvedValueOnce({ records: [mockCountRecord] }); // count query
      entityFactory.createGraphList.mockReturnValue(mockEntities);

      const params: QueryType<any> = {
        query: "MATCH (n:TestEntity) RETURN n {CURSOR}",
        queryParams: {},
        serialiser,
        cursor: { take: 25 },
        fetchAll: false,
      };

      // Act
      const result = await service.readMany(params);

      // Assert
      expect(result).toEqual(mockEntities);
      expect(clsService.set).toHaveBeenCalledWith("queryTotal", 100);
    });

    it("should clear previous queryTotal before execution", async () => {
      // Arrange
      const serialiser = createMockSerialiser();
      mockTxRun.mockResolvedValue({ records: [] });
      entityFactory.createGraphList.mockReturnValue([]);

      const params: QueryType<any> = {
        query: "MATCH (n) RETURN n {CURSOR}",
        queryParams: {},
        serialiser,
        cursor: { take: 25 },
        fetchAll: false,
      };

      // Act
      await service.readMany(params);

      // Assert
      expect(clsService.set).toHaveBeenCalledWith("queryTotal", undefined);
    });

    it("should handle count as plain number without toNumber method", async () => {
      // Arrange
      const serialiser = createMockSerialiser();
      const mockCountRecord = {
        get: vi.fn().mockReturnValue(50), // plain number
      };
      mockTxRun.mockResolvedValueOnce({ records: [{}] }).mockResolvedValueOnce({ records: [mockCountRecord] });
      entityFactory.createGraphList.mockReturnValue([]);

      const params: QueryType<any> = {
        query: "MATCH (n:TestEntity) RETURN n {CURSOR}",
        queryParams: {},
        serialiser,
        cursor: { take: 25 },
        fetchAll: false,
      };

      // Act
      await service.readMany(params);

      // Assert
      expect(clsService.set).toHaveBeenCalledWith("queryTotal", 50);
    });

    it("should fallback without count when no serialiser provided", async () => {
      // Arrange
      mockTxRun.mockResolvedValue({ records: [{}] });
      entityFactory.createGraphList.mockReturnValue([]);

      const params: QueryType<any> = {
        query: "MATCH (n) RETURN n {CURSOR}",
        queryParams: {},
        cursor: { take: 25 },
        fetchAll: false,
      };

      // Act
      await service.readMany(params);

      // Assert
      // Count query should not have been called
      expect(clsService.set).toHaveBeenCalledWith("queryTotal", undefined);
    });

    it("should remove cursor placeholder when fetchAll is true", async () => {
      // Arrange
      const serialiser = createMockSerialiser();
      mockTxRun.mockResolvedValue({ records: [{}] });
      entityFactory.createGraphList.mockReturnValue([]);

      const params: QueryType<any> = {
        query: "MATCH (n) RETURN n {CURSOR}",
        queryParams: {},
        serialiser,
        fetchAll: true,
      };

      // Act
      await service.readMany(params);

      // Assert
      expect(params.query).not.toContain("{CURSOR}");
    });

    it("should log and rethrow error on failure", async () => {
      // Arrange
      const error = new Error("Database error");
      mockTxRun.mockRejectedValue(error);

      const params: QueryType<any> = {
        query: "MATCH (n) RETURN n",
        queryParams: {},
      };

      // Act & Assert
      await expect(service.readMany(params)).rejects.toThrow("Neo4j Read Error: Database error");
      expect(logger.error).toHaveBeenCalled();
    });
  });

  describe("writeOne", () => {
    it("should write and return single entity", async () => {
      // Arrange
      const serialiser = createMockSerialiser();
      const mockEntity = { id: TEST_IDS.companyId, name: "Test" };
      mockTxRun.mockResolvedValue({ records: [{ data: "test" }] });
      entityFactory.createGraphList.mockReturnValue([mockEntity]);

      const params: QueryType<any> = {
        query: "CREATE (n:Test) RETURN n",
        queryParams: {},
        serialiser,
      };

      // Act
      const result = await service.writeOne(params);

      // Assert
      expect(result).toEqual(mockEntity);
    });

    it("should return null when no serialiser provided", async () => {
      // Arrange
      mockTxRun.mockResolvedValue({ records: [{ data: "test" }] });

      const params: QueryType<any> = {
        query: "CREATE (n:Test) RETURN n",
        queryParams: {},
      };

      // Act
      const result = await service.writeOne(params);

      // Assert
      expect(result).toBeNull();
    });

    it("should return null when no records returned", async () => {
      // Arrange
      const serialiser = createMockSerialiser();
      mockTxRun.mockResolvedValue({ records: [] });

      const params: QueryType<any> = {
        query: "CREATE (n:Test) RETURN n",
        queryParams: {},
        serialiser,
      };

      // Act
      const result = await service.writeOne(params);

      // Assert
      expect(result).toBeNull();
    });

    it("should return null when entity factory returns empty array", async () => {
      // Arrange
      const serialiser = createMockSerialiser();
      mockTxRun.mockResolvedValue({ records: [{ data: "test" }] });
      entityFactory.createGraphList.mockReturnValue([]);

      const params: QueryType<any> = {
        query: "CREATE (n:Test) RETURN n",
        queryParams: {},
        serialiser,
      };

      // Act
      const result = await service.writeOne(params);

      // Assert
      expect(result).toBeNull();
    });
  });

  describe("writeAndReturnMany", () => {
    it("should write and return multiple entities", async () => {
      // Arrange
      const serialiser = createMockSerialiser();
      const mockEntities = [
        { id: "1", name: "Test1" },
        { id: "2", name: "Test2" },
      ];
      mockTxRun.mockResolvedValue({ records: [{ data: "test" }] });
      entityFactory.createGraphList.mockReturnValue(mockEntities);

      const params: QueryType<any> = {
        query: "CREATE (n:Test) RETURN n",
        queryParams: {},
        serialiser,
      };

      // Act
      const result = await service.writeAndReturnMany(params);

      // Assert
      expect(result).toEqual(mockEntities);
    });

    it("should return null when no serialiser provided", async () => {
      // Arrange
      mockTxRun.mockResolvedValue({ records: [{ data: "test" }] });

      const params: QueryType<any> = {
        query: "CREATE (n:Test) RETURN n",
        queryParams: {},
      };

      // Act
      const result = await service.writeAndReturnMany(params);

      // Assert
      expect(result).toBeNull();
    });

    it("should return null when no records returned", async () => {
      // Arrange
      const serialiser = createMockSerialiser();
      mockTxRun.mockResolvedValue({ records: [] });

      const params: QueryType<any> = {
        query: "CREATE (n:Test) RETURN n",
        queryParams: {},
        serialiser,
      };

      // Act
      const result = await service.writeAndReturnMany(params);

      // Assert
      expect(result).toBeNull();
    });
  });

  describe("readCount", () => {
    it("should return count from query result", async () => {
      // Arrange
      const mockRecord = {
        get: vi.fn().mockReturnValue({ toNumber: () => 42 }),
      };
      mockTxRun.mockResolvedValue({ records: [mockRecord] });

      // Act
      const result = await service.readCount("MATCH (n) RETURN count(n) AS total");

      // Assert
      expect(result).toBe(42);
    });

    it("should return 0 when no records found", async () => {
      // Arrange
      mockTxRun.mockResolvedValue({ records: [] });

      // Act
      const result = await service.readCount("MATCH (n) RETURN count(n) AS total");

      // Assert
      expect(result).toBe(0);
    });

    it("should handle plain number without toNumber method", async () => {
      // Arrange
      const mockRecord = {
        get: vi.fn().mockReturnValue(100),
      };
      mockTxRun.mockResolvedValue({ records: [mockRecord] });

      // Act
      const result = await service.readCount("MATCH (n) RETURN count(n) AS total");

      // Assert
      expect(result).toBe(100);
    });

    it("should return 0 when count is null", async () => {
      // Arrange
      const mockRecord = {
        get: vi.fn().mockReturnValue(null),
      };
      mockTxRun.mockResolvedValue({ records: [mockRecord] });

      // Act
      const result = await service.readCount("MATCH (n) RETURN count(n) AS total");

      // Assert
      expect(result).toBe(0);
    });
  });

  describe("read", () => {
    it("should execute read transaction", async () => {
      // Arrange
      mockTxRun.mockResolvedValue({ records: [{ data: "test" }] });

      // Act
      const result = await service.read("MATCH (n) RETURN n", { id: "123" });

      // Assert
      expect(result).toEqual({ records: [{ data: "test" }] });
      expect(mockTxRun).toHaveBeenCalledWith("MATCH (n) RETURN n", { id: "123" });
    });

    it("should use empty object for params when not provided", async () => {
      // Arrange
      mockTxRun.mockResolvedValue({ records: [] });

      // Act
      await service.read("MATCH (n) RETURN n");

      // Assert
      expect(mockTxRun).toHaveBeenCalledWith("MATCH (n) RETURN n", {});
    });

    it("should close session after read", async () => {
      // Arrange
      mockTxRun.mockResolvedValue({ records: [] });

      // Act
      await service.read("MATCH (n) RETURN n");

      // Assert
      expect(mockSession.close).toHaveBeenCalled();
    });

    it("should throw wrapped error on failure", async () => {
      // Arrange
      const error = new Error("Connection failed");
      mockTxRun.mockRejectedValue(error);

      // Act & Assert
      await expect(service.read("MATCH (n) RETURN n")).rejects.toThrow("Neo4j Read Error: Connection failed");
      expect(logger.error).toHaveBeenCalled();
    });

    it("should throw generic error for non-Error exceptions", async () => {
      // Arrange
      mockTxRun.mockRejectedValue("string error");

      // Act & Assert
      await expect(service.read("MATCH (n) RETURN n")).rejects.toThrow(
        "Neo4j Read Error: An unknown error occurred while reading the data",
      );
    });
  });

  describe("validateExistingNodes", () => {
    it("should not throw when all nodes exist", async () => {
      // Arrange
      mockTxRun.mockResolvedValue({ records: [{ n0: {}, n1: {} }] });

      const nodes = [
        { id: "123", label: "User" },
        { id: "456", label: "Company" },
      ];

      // Act & Assert
      await expect(service.validateExistingNodes({ nodes })).resolves.not.toThrow();
    });

    it("should throw BadRequestException when nodes do not exist", async () => {
      // Arrange
      mockTxRun.mockResolvedValue({ records: [] });

      const nodes = [{ id: "123", label: "User" }];

      // Act & Assert
      await expect(service.validateExistingNodes({ nodes })).rejects.toThrow(BadRequestException);
      await expect(service.validateExistingNodes({ nodes })).rejects.toThrow("One or more related nodes do not exist.");
    });

    it("should do nothing when nodes array is empty", async () => {
      // Act
      await service.validateExistingNodes({ nodes: [] });

      // Assert
      expect(mockTxRun).not.toHaveBeenCalled();
    });

    it("should construct correct match query for multiple nodes", async () => {
      // Arrange
      mockTxRun.mockResolvedValue({ records: [{}] });

      const nodes = [
        { id: "123", label: "User" },
        { id: "456", label: "Company" },
      ];

      // Act
      await service.validateExistingNodes({ nodes });

      // Assert
      expect(mockTxRun).toHaveBeenCalledWith(
        expect.stringContaining("MATCH (n0:User {id: $id0})"),
        expect.objectContaining({ id0: "123", id1: "456" }),
      );
    });
  });

  describe("getActiveConnections", () => {
    it("should return active connection count", () => {
      // Act
      const count = service.getActiveConnections();

      // Assert
      expect(count).toBe(0);
    });
  });

  describe("cleanup", () => {
    it("should close the driver", async () => {
      // Act
      await service.cleanup();

      // Assert
      expect(mockDriver.close).toHaveBeenCalled();
    });

    it("should log error when cleanup fails", async () => {
      // Arrange
      const error = new Error("Cleanup failed");
      mockDriver.close.mockRejectedValueOnce(error);

      // Act
      await service.cleanup();

      // Assert
      expect(logger.error).toHaveBeenCalledWith("Error during Neo4j driver cleanup:", error);
    });
  });

  describe("executeInTransaction", () => {
    it("should execute multiple queries in transaction", async () => {
      // Arrange
      const mockTransaction = {
        run: vi.fn().mockResolvedValue({ records: [{}] }),
        commit: vi.fn().mockResolvedValue(undefined),
        rollback: vi.fn(),
      };
      mockSession.beginTransaction.mockReturnValue(mockTransaction);

      const queries = [
        { query: "CREATE (n:Test {id: $id})", params: { id: "1" } },
        { query: "CREATE (n:Test {id: $id})", params: { id: "2" } },
      ];

      // Act
      const results = await service.executeInTransaction(queries);

      // Assert
      expect(results).toHaveLength(2);
      expect(mockTransaction.run).toHaveBeenCalledTimes(2);
      expect(mockTransaction.commit).toHaveBeenCalled();
    });

    it("should rollback transaction on failure", async () => {
      // Arrange
      const error = new Error("Query failed");
      const mockTransaction = {
        run: vi.fn().mockRejectedValue(error),
        commit: vi.fn(),
        rollback: vi.fn().mockResolvedValue(undefined),
      };
      mockSession.beginTransaction.mockReturnValue(mockTransaction);

      const queries = [{ query: "CREATE (n:Test)", params: {} }];

      // Act & Assert
      await expect(service.executeInTransaction(queries)).rejects.toThrow("Transaction failed: Query failed");
      expect(mockTransaction.rollback).toHaveBeenCalled();
    });

    it("should close session after transaction", async () => {
      // Arrange
      const mockTransaction = {
        run: vi.fn().mockResolvedValue({ records: [] }),
        commit: vi.fn().mockResolvedValue(undefined),
        rollback: vi.fn(),
      };
      mockSession.beginTransaction.mockReturnValue(mockTransaction);

      const queries = [{ query: "CREATE (n:Test)", params: {} }];

      // Act
      await service.executeInTransaction(queries);

      // Assert
      expect(mockSession.close).toHaveBeenCalled();
    });
  });

  describe("onModuleInit", () => {
    it("should be defined and callable", async () => {
      // Act & Assert
      await expect(service.onModuleInit()).resolves.not.toThrow();
    });
  });

  describe("onModuleDestroy", () => {
    it("should close the driver", async () => {
      // Act
      await service.onModuleDestroy();

      // Assert
      expect(mockDriver.close).toHaveBeenCalled();
    });
  });

  describe("write retry logic", () => {
    it("should retry write operations on failure", async () => {
      // Arrange
      const serialiser = createMockSerialiser();
      const error = new Error("Temporary failure");
      mockTxRun
        .mockRejectedValueOnce(error)
        .mockRejectedValueOnce(error)
        .mockResolvedValueOnce({ records: [{ data: "success" }] });
      entityFactory.createGraphList.mockReturnValue([{ id: "1" }]);

      const params: QueryType<any> = {
        query: "CREATE (n:Test) RETURN n",
        queryParams: {},
        serialiser,
      };

      // Act
      const result = await service.writeOne(params);

      // Assert
      expect(result).toEqual({ id: "1" });
      expect(mockTxRun).toHaveBeenCalledTimes(3);
    });

    it("should throw after max retries exhausted", async () => {
      // Arrange
      const error = new Error("Persistent failure");
      mockTxRun.mockRejectedValue(error);

      const params: QueryType<any> = {
        query: "CREATE (n:Test) RETURN n",
        queryParams: {},
      };

      // Act & Assert
      await expect(service.writeOne(params)).rejects.toThrow("Persistent failure");
    });
  });
});
