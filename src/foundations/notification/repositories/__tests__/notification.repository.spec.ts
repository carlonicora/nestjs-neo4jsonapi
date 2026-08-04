import { vi, describe, it, expect, beforeEach, afterEach } from "vitest";
import { Test, TestingModule } from "@nestjs/testing";
import { ClsService } from "nestjs-cls";
import { NotificationRepository } from "../notification.repository";
import { Neo4jService } from "../../../../core/neo4j/services/neo4j.service";
import { SecurityService } from "../../../../core/security/services/security.service";
import { Notification, NotificationDescriptor } from "../../entities/notification";

// Test IDs
const TEST_IDS = {
  companyId: "550e8400-e29b-41d4-a716-446655440000",
  userId: "660e8400-e29b-41d4-a716-446655440001",
  actorId: "770e8400-e29b-41d4-a716-446655440002",
  notificationId1: "880e8400-e29b-41d4-a716-446655440003",
  notificationId2: "990e8400-e29b-41d4-a716-446655440004",
  taskId: "aa0e8400-e29b-41d4-a716-446655440005",
  documentId: "bb0e8400-e29b-41d4-a716-446655440006",
};

// Mock factories
const createMockNeo4jService = () => ({
  writeOne: vi.fn(),
  readOne: vi.fn(),
  readMany: vi.fn(),
  read: vi.fn().mockResolvedValue({ records: [] }),
  initQuery: vi.fn(),
  validateExistingNodes: vi.fn(),
});

/**
 * Wire-contract pins for the descriptor that replaced the hand-written
 * `NotificationModel` + `NotificationSerialiser`. Any change here is a change
 * to what every consuming application's clients receive.
 */
describe("NotificationDescriptor", () => {
  it("keeps the old serialiser's attribute surface", () => {
    const serialised = Object.entries(NotificationDescriptor.fields)
      .filter(([, def]: [string, any]) => !def.excludeFromJsonApi && !def.meta)
      .map(([name]) => name)
      .sort();

    // from the deleted NotificationSerialiser.create() attributes
    expect(serialised).toEqual(["actionUrl", "isRead", "message", "notificationType"]);
  });

  it("keeps the old meta surface (none)", () => {
    const meta = Object.entries(NotificationDescriptor.fields)
      .filter(([, def]: [string, any]) => def.meta)
      .map(([name]) => name)
      .sort();

    // the deleted NotificationSerialiser.create() declared no meta fields
    expect(meta).toEqual([]);
  });

  it("keeps the old relationship surface: a single to-one actor on the User model", () => {
    expect(Object.keys(NotificationDescriptor.relationships).sort()).toEqual(["actor"]);
    expect(NotificationDescriptor.relationships.actor.cardinality).toBe("one");
    expect(NotificationDescriptor.relationships.actor.relationship).toBe("TRIGGERED_BY");
    expect(NotificationDescriptor.relationships.actor.direction).toBe("out");
    // the old serialiser declared key `user` with `name: "actor"` — same wire key
    expect(NotificationDescriptor.relationships.actor.dtoKey).toBe("actor");
    expect(NotificationDescriptor.relationships.actor.model.labelName).toBe("User");
  });

  it("stays company-scoped", () => {
    expect(NotificationDescriptor.isCompanyScoped).toBe(true);
  });
});

describe("NotificationRepository", () => {
  let repository: NotificationRepository;
  let neo4jService: ReturnType<typeof createMockNeo4jService>;

  const createMockQuery = () => ({
    query: "",
    queryParams: {} as Record<string, any>,
  });

  const MOCK_NOTIFICATION: Notification = {
    id: TEST_IDS.notificationId1,
    notificationType: "MENTION",
    isRead: false,
    createdAt: new Date("2025-01-01T00:00:00Z"),
    updatedAt: new Date("2025-01-01T00:00:00Z"),
  } as Notification;

  beforeEach(async () => {
    neo4jService = createMockNeo4jService();

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        NotificationRepository,
        { provide: Neo4jService, useValue: neo4jService },
        {
          provide: SecurityService,
          useValue: { userHasAccess: vi.fn().mockImplementation(({ validator }) => validator()) },
        },
        { provide: ClsService, useValue: { get: vi.fn(), set: vi.fn(), has: vi.fn().mockReturnValue(false) } },
      ],
    }).compile();

    repository = module.get<NotificationRepository>(NotificationRepository);
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  describe("onModuleInit", () => {
    it("should create unique constraint on id field", async () => {
      neo4jService.writeOne.mockResolvedValue(undefined);

      await repository.onModuleInit();

      expect(neo4jService.writeOne).toHaveBeenCalledWith({
        query:
          "CREATE CONSTRAINT notification_id IF NOT EXISTS FOR (notification:Notification) REQUIRE notification.id IS UNIQUE",
      });
    });

    it("should create the idempotency-key constraint", async () => {
      neo4jService.writeOne.mockResolvedValue(undefined);

      await repository.onModuleInit();

      expect(neo4jService.writeOne).toHaveBeenCalledWith({
        query:
          "CREATE CONSTRAINT notification_idempotency_key IF NOT EXISTS FOR (notification:Notification) REQUIRE notification.idempotencyKey IS UNIQUE",
      });
    });

    it("should create exactly the two constraints and no index", async () => {
      neo4jService.writeOne.mockResolvedValue(undefined);

      await repository.onModuleInit();

      expect(neo4jService.writeOne).toHaveBeenCalledTimes(2);
      // no FULLTEXT index: the base implementation is deliberately not called
      expect(neo4jService.read).not.toHaveBeenCalled();
    });

    it("should handle errors", async () => {
      neo4jService.writeOne.mockRejectedValue(new Error("Constraint creation failed"));

      await expect(repository.onModuleInit()).rejects.toThrow("Constraint creation failed");
    });
  });

  describe("findForUser", () => {
    it("should find notifications for a user", async () => {
      const mockQuery = createMockQuery();
      neo4jService.initQuery.mockReturnValue(mockQuery);
      neo4jService.readMany.mockResolvedValue([MOCK_NOTIFICATION]);

      const result = await repository.findForUser({ userId: TEST_IDS.userId });

      expect(mockQuery.queryParams.userId).toBe(TEST_IDS.userId);
      expect(mockQuery.query).toContain(":TRIGGERED_FOR");
      expect(mockQuery.query).toContain("ORDER BY notification.createdAt DESC");
      expect(result).toEqual([MOCK_NOTIFICATION]);
    });

    it("should only list notifications that have a REFERS_TO subject", async () => {
      const mockQuery = createMockQuery();
      neo4jService.initQuery.mockReturnValue(mockQuery);
      neo4jService.readMany.mockResolvedValue([]);

      await repository.findForUser({ userId: TEST_IDS.userId });

      expect(mockQuery.query).toContain("WHERE EXISTS { MATCH (notification)-[:REFERS_TO]->() }");
    });

    it("should paginate through the {CURSOR} placeholder", async () => {
      const mockQuery = createMockQuery();
      neo4jService.initQuery.mockReturnValue(mockQuery);
      neo4jService.readMany.mockResolvedValue([]);

      await repository.findForUser({ userId: TEST_IDS.userId });

      expect(mockQuery.query).toContain("{CURSOR}");
    });

    it("should alias the actor as notification_actor so the descriptor hydrates it", async () => {
      const mockQuery = createMockQuery();
      neo4jService.initQuery.mockReturnValue(mockQuery);
      neo4jService.readMany.mockResolvedValue([]);

      await repository.findForUser({ userId: TEST_IDS.userId });

      expect(mockQuery.query).toContain("OPTIONAL MATCH (notification)-[:TRIGGERED_BY]->(notification_actor:User)");
      const returnClause = mockQuery.query.slice(mockQuery.query.indexOf("RETURN"));
      expect(returnClause).toMatch(/\bnotification_actor\b/);
    });

    it("should filter archived notifications when isArchived is true", async () => {
      const mockQuery = createMockQuery();
      neo4jService.initQuery.mockReturnValue(mockQuery);
      neo4jService.readMany.mockResolvedValue([]);

      await repository.findForUser({ userId: TEST_IDS.userId, isArchived: true });

      expect(mockQuery.query).toContain("notification.isArchived = true");
    });

    it("should filter non-archived notifications when isArchived is false/undefined", async () => {
      const mockQuery = createMockQuery();
      neo4jService.initQuery.mockReturnValue(mockQuery);
      neo4jService.readMany.mockResolvedValue([MOCK_NOTIFICATION]);

      await repository.findForUser({ userId: TEST_IDS.userId });

      expect(mockQuery.query).toContain("notification.isArchived IS null");
    });

    it("should pass cursor to initQuery", async () => {
      const mockQuery = createMockQuery();
      neo4jService.initQuery.mockReturnValue(mockQuery);
      neo4jService.readMany.mockResolvedValue([]);

      const cursor = { limit: 10, offset: 0 } as any;
      await repository.findForUser({ userId: TEST_IDS.userId, cursor });

      expect(neo4jService.initQuery).toHaveBeenCalledWith(expect.objectContaining({ cursor }));
    });
  });

  describe("findByIdForUser", () => {
    it("should find notification by ID", async () => {
      const mockQuery = createMockQuery();
      neo4jService.initQuery.mockReturnValue(mockQuery);
      neo4jService.readOne.mockResolvedValue(MOCK_NOTIFICATION);

      const result = await repository.findByIdForUser({
        notificationId: TEST_IDS.notificationId1,
        userId: TEST_IDS.userId,
      });

      expect(mockQuery.queryParams.notificationId).toBe(TEST_IDS.notificationId1);
      expect(mockQuery.queryParams.userId).toBe(TEST_IDS.userId);
      expect(mockQuery.query).toContain("id: $notificationId");
      expect(result).toEqual(MOCK_NOTIFICATION);
    });

    it("should return null when notification not found", async () => {
      const mockQuery = createMockQuery();
      neo4jService.initQuery.mockReturnValue(mockQuery);
      neo4jService.readOne.mockResolvedValue(null);

      const result = await repository.findByIdForUser({
        notificationId: "nonexistent",
        userId: TEST_IDS.userId,
      });

      expect(result).toBeNull();
    });
  });

  describe("markAsRead", () => {
    it("should mark notifications as read", async () => {
      const mockQuery = createMockQuery();
      neo4jService.initQuery.mockReturnValue(mockQuery);
      neo4jService.writeOne.mockResolvedValue(undefined);

      const notificationIds = [TEST_IDS.notificationId1, TEST_IDS.notificationId2];
      await repository.markAsRead({ userId: TEST_IDS.userId, notificationIds });

      expect(mockQuery.queryParams.userId).toBe(TEST_IDS.userId);
      expect(mockQuery.queryParams.notificationIds).toEqual(notificationIds);
      expect(mockQuery.query).toContain("notification.id IN $notificationIds");
      expect(mockQuery.query).toContain("SET notification.isRead = true");
      expect(neo4jService.writeOne).toHaveBeenCalledWith(mockQuery);
    });
  });

  describe("archive", () => {
    it("should archive notification", async () => {
      const mockQuery = createMockQuery();
      neo4jService.initQuery.mockReturnValue(mockQuery);
      neo4jService.writeOne.mockResolvedValue(undefined);

      await repository.archive({ notificationId: TEST_IDS.notificationId1 });

      expect(mockQuery.queryParams.notificationId).toBe(TEST_IDS.notificationId1);
      expect(mockQuery.query).toContain("SET notification.isArchived = true");
      expect(mockQuery.query).toContain("notification.updatedAt = datetime()");
      expect(neo4jService.writeOne).toHaveBeenCalledWith(mockQuery);
    });
  });

  describe("createNotification", () => {
    it("should create notification with actor", async () => {
      const mockQuery = createMockQuery();
      neo4jService.initQuery.mockReturnValue(mockQuery);
      neo4jService.validateExistingNodes.mockResolvedValue(undefined);
      neo4jService.writeOne.mockResolvedValue(undefined);
      neo4jService.readOne.mockResolvedValue(MOCK_NOTIFICATION);

      const result = await repository.createNotification({
        notificationType: "MENTION",
        userId: TEST_IDS.userId,
        actorId: TEST_IDS.actorId,
      });

      expect(neo4jService.validateExistingNodes).toHaveBeenCalled();
      expect(mockQuery.queryParams.notificationType).toBe("MENTION");
      expect(mockQuery.query).toContain("CREATE (notification:Notification");
      expect(neo4jService.writeOne).toHaveBeenCalledWith(mockQuery);
      expect(result).toEqual(MOCK_NOTIFICATION);
    });

    it("should create notification without actor", async () => {
      const mockQuery = createMockQuery();
      neo4jService.initQuery.mockReturnValue(mockQuery);
      neo4jService.validateExistingNodes.mockResolvedValue(undefined);
      neo4jService.writeOne.mockResolvedValue(undefined);
      neo4jService.readOne.mockResolvedValue(MOCK_NOTIFICATION);

      await repository.createNotification({
        notificationType: "SYSTEM",
        userId: TEST_IDS.userId,
      });

      expect(mockQuery.queryParams.notificationType).toBe("SYSTEM");
      expect(neo4jService.writeOne).toHaveBeenCalled();
    });

    it("should generate UUID for new notification", async () => {
      const mockQuery = createMockQuery();
      neo4jService.initQuery.mockReturnValue(mockQuery);
      neo4jService.validateExistingNodes.mockResolvedValue(undefined);
      neo4jService.writeOne.mockResolvedValue(undefined);
      neo4jService.readOne.mockResolvedValue(MOCK_NOTIFICATION);

      await repository.createNotification({
        notificationType: "MENTION",
        userId: TEST_IDS.userId,
      });

      expect(mockQuery.queryParams.notificationId).toMatch(
        /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/,
      );
    });

    describe("targets (REFERS_TO subjects)", () => {
      it("should validate every target node before writing", async () => {
        const mockQuery = createMockQuery();
        neo4jService.initQuery.mockReturnValue(mockQuery);
        neo4jService.validateExistingNodes.mockResolvedValue(undefined);
        neo4jService.writeOne.mockResolvedValue(undefined);
        neo4jService.readOne.mockResolvedValue(MOCK_NOTIFICATION);

        await repository.createNotification({
          notificationType: "TASK_ASSIGNED",
          userId: TEST_IDS.userId,
          targets: [{ id: TEST_IDS.taskId, label: "Task" }],
        });

        expect(neo4jService.validateExistingNodes).toHaveBeenCalledWith(
          expect.objectContaining({
            nodes: expect.arrayContaining([{ id: TEST_IDS.taskId, label: "Task" }]),
          }),
        );
      });

      it("should write a REFERS_TO edge for a supplied target", async () => {
        const mockQuery = createMockQuery();
        neo4jService.initQuery.mockReturnValue(mockQuery);
        neo4jService.validateExistingNodes.mockResolvedValue(undefined);
        neo4jService.writeOne.mockResolvedValue(undefined);
        neo4jService.readOne.mockResolvedValue(MOCK_NOTIFICATION);

        await repository.createNotification({
          notificationType: "TASK_ASSIGNED",
          userId: TEST_IDS.userId,
          targets: [{ id: TEST_IDS.taskId, label: "Task" }],
        });

        expect(mockQuery.query).toContain("[rel:REFERS_TO]->");
        expect(mockQuery.query).toContain("MATCH (new:Task {id: id})");
        expect(mockQuery.queryParams.targetIds0).toEqual([TEST_IDS.taskId]);
      });

      it("should write one REFERS_TO group per distinct label", async () => {
        const mockQuery = createMockQuery();
        neo4jService.initQuery.mockReturnValue(mockQuery);
        neo4jService.validateExistingNodes.mockResolvedValue(undefined);
        neo4jService.writeOne.mockResolvedValue(undefined);
        neo4jService.readOne.mockResolvedValue(MOCK_NOTIFICATION);

        await repository.createNotification({
          notificationType: "DOCUMENT_UPLOADED",
          userId: TEST_IDS.userId,
          targets: [
            { id: TEST_IDS.taskId, label: "Task" },
            { id: TEST_IDS.documentId, label: "Document" },
          ],
        });

        expect(mockQuery.queryParams.targetIds0).toEqual([TEST_IDS.taskId]);
        expect(mockQuery.queryParams.targetIds1).toEqual([TEST_IDS.documentId]);
        expect(mockQuery.query).toContain("MATCH (new:Document {id: id})");
      });

      it("should reject a label that is not a safe Neo4j identifier", async () => {
        const mockQuery = createMockQuery();
        neo4jService.initQuery.mockReturnValue(mockQuery);

        await expect(
          repository.createNotification({
            notificationType: "TASK_ASSIGNED",
            userId: TEST_IDS.userId,
            targets: [{ id: TEST_IDS.taskId, label: "Task) DETACH DELETE (n" }],
          }),
        ).rejects.toThrow(/Invalid Neo4j label/);

        expect(neo4jService.writeOne).not.toHaveBeenCalled();
      });

      /**
       * Silent-failure regression (spec §7 #2): a notification created WITH a
       * target must be visible in the recipient's own list. The list filter is
       * `EXISTS { MATCH (notification)-[:REFERS_TO]->() }` — so the create path
       * must emit exactly that edge direction/type.
       */
      it("should create a notification that passes its own findForUser filter", async () => {
        const createQuery = createMockQuery();
        neo4jService.initQuery.mockReturnValue(createQuery);
        neo4jService.validateExistingNodes.mockResolvedValue(undefined);
        neo4jService.writeOne.mockResolvedValue(undefined);
        neo4jService.readOne.mockResolvedValue(MOCK_NOTIFICATION);

        await repository.createNotification({
          notificationType: "TASK_ASSIGNED",
          userId: TEST_IDS.userId,
          targets: [{ id: TEST_IDS.taskId, label: "Task" }],
        });

        const listQuery = createMockQuery();
        neo4jService.initQuery.mockReturnValue(listQuery);
        neo4jService.readMany.mockResolvedValue([]);
        await repository.findForUser({ userId: TEST_IDS.userId });

        // the edge the create path writes …
        expect(createQuery.query).toContain("MERGE (notification)-[rel:REFERS_TO]->(new)");
        // … is exactly the edge the list filter requires
        expect(listQuery.query).toContain("WHERE EXISTS { MATCH (notification)-[:REFERS_TO]->() }");
      });

      it("should write no REFERS_TO edge when no target is supplied (legacy behaviour)", async () => {
        const mockQuery = createMockQuery();
        neo4jService.initQuery.mockReturnValue(mockQuery);
        neo4jService.validateExistingNodes.mockResolvedValue(undefined);
        neo4jService.writeOne.mockResolvedValue(undefined);
        neo4jService.readOne.mockResolvedValue(MOCK_NOTIFICATION);

        await repository.createNotification({
          notificationType: "SYSTEM",
          userId: TEST_IDS.userId,
        });

        expect(mockQuery.query).not.toContain("REFERS_TO");
      });
    });
  });

  describe("createIdempotent", () => {
    // Primes writeOne to capture the generated notificationId, then primes the follow-up
    // read to return either the same id ("just created") or a different one ("another call won").
    function primeMocks(opts: { existing: boolean }) {
      let capturedId: string | undefined;
      neo4jService.initQuery.mockImplementation(() => createMockQuery());
      neo4jService.writeOne.mockImplementation(async (q: any) => {
        capturedId = q.queryParams.notificationId;
        return null;
      });
      neo4jService.read.mockImplementation(async () => ({
        records: [{ get: vi.fn().mockReturnValue(opts.existing ? "existing-id" : capturedId) }],
      }));
    }

    it("creates a notification on first call and returns { created: true }", async () => {
      primeMocks({ existing: false });

      const result = await repository.createIdempotent({
        notificationType: "person.access_granted",
        userId: TEST_IDS.userId,
        actorId: TEST_IDS.actorId,
        targets: [{ id: TEST_IDS.taskId, label: "Task" }],
        idempotencyKey: `person.access_granted:${TEST_IDS.actorId}:${TEST_IDS.taskId}`,
      });

      expect(result).toEqual({ created: true });
      const writeArg = neo4jService.writeOne.mock.calls[0][0];
      expect(writeArg.query).toContain("MERGE");
      expect(writeArg.query).toContain("idempotencyKey");
      expect(writeArg.query).toContain("TRIGGERED_FOR");
      expect(writeArg.query).toContain("TRIGGERED_BY");
      expect(writeArg.query).toContain("REFERS_TO");
      expect(writeArg.queryParams.idempotencyKey).toBe(`person.access_granted:${TEST_IDS.actorId}:${TEST_IDS.taskId}`);
      expect(writeArg.queryParams.userId).toBe(TEST_IDS.userId);
      expect(writeArg.queryParams.actorId).toBe(TEST_IDS.actorId);
      expect(writeArg.queryParams.target0Id).toBe(TEST_IDS.taskId);
    });

    it("sets isRead false ON CREATE only", async () => {
      primeMocks({ existing: false });

      await repository.createIdempotent({
        notificationType: "person.access_granted",
        userId: TEST_IDS.userId,
        actorId: TEST_IDS.actorId,
        idempotencyKey: "test-key",
      });

      const writeArg = neo4jService.writeOne.mock.calls[0][0];
      expect(writeArg.query).toContain("ON CREATE SET");
      expect(writeArg.query).toContain("notification.isRead = false");
    });

    it("returns { created: false } on repeat call with same key (pre-existing notification wins)", async () => {
      primeMocks({ existing: true });

      const result = await repository.createIdempotent({
        notificationType: "person.access_granted",
        userId: TEST_IDS.userId,
        actorId: TEST_IDS.actorId,
        idempotencyKey: "person.access_granted:repeat",
      });

      expect(result).toEqual({ created: false });
    });

    it("guards every edge write behind the justCreated flag", async () => {
      primeMocks({ existing: false });

      await repository.createIdempotent({
        notificationType: "person.access_granted",
        userId: TEST_IDS.userId,
        actorId: TEST_IDS.actorId,
        targets: [{ id: TEST_IDS.taskId, label: "Task" }],
        idempotencyKey: "test-key",
      });

      const writeArg = neo4jService.writeOne.mock.calls[0][0];
      expect(writeArg.query).toContain("notification.id = $notificationId AS justCreated");
      expect(writeArg.query).toContain("CASE WHEN justCreated AND target0 IS NOT NULL");
      expect(writeArg.query).toContain("CASE WHEN justCreated AND actor IS NOT NULL");
    });

    it("defaults the actor label to User and honours an explicit one", async () => {
      primeMocks({ existing: false });

      await repository.createIdempotent({
        notificationType: "person.access_granted",
        userId: TEST_IDS.userId,
        actorId: TEST_IDS.actorId,
        idempotencyKey: "default-actor-label",
      });
      expect(neo4jService.writeOne.mock.calls[0][0].query).toContain("(actor:User {id: $actorId})");

      neo4jService.writeOne.mockClear();
      await repository.createIdempotent({
        notificationType: "person.access_granted",
        userId: TEST_IDS.userId,
        actorId: TEST_IDS.actorId,
        actorLabel: "Person",
        idempotencyKey: "explicit-actor-label",
      });
      expect(neo4jService.writeOne.mock.calls[0][0].query).toContain("(actor:Person {id: $actorId})");
    });

    it("rejects an unsafe actor label", async () => {
      primeMocks({ existing: false });

      await expect(
        repository.createIdempotent({
          notificationType: "person.access_granted",
          userId: TEST_IDS.userId,
          actorId: TEST_IDS.actorId,
          actorLabel: "User) DETACH DELETE (n",
          idempotencyKey: "unsafe",
        }),
      ).rejects.toThrow(/Invalid Neo4j label/);

      expect(neo4jService.writeOne).not.toHaveBeenCalled();
    });

    it("generates a UUID for the notification", async () => {
      primeMocks({ existing: false });

      await repository.createIdempotent({
        notificationType: "person.access_granted",
        userId: TEST_IDS.userId,
        actorId: TEST_IDS.actorId,
        idempotencyKey: "test-key",
      });

      const writeArg = neo4jService.writeOne.mock.calls[0][0];
      expect(writeArg.queryParams.notificationId).toMatch(
        /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/,
      );
    });

    it("returns { created: false } when the follow-up read finds no record (data anomaly)", async () => {
      neo4jService.initQuery.mockImplementation(() => createMockQuery());
      neo4jService.writeOne.mockResolvedValue(null);
      neo4jService.read.mockResolvedValue({ records: [] });

      const result = await repository.createIdempotent({
        notificationType: "person.access_granted",
        userId: TEST_IDS.userId,
        actorId: TEST_IDS.actorId,
        idempotencyKey: "test-key",
      });

      expect(result).toEqual({ created: false });
    });
  });

  describe("Edge Cases", () => {
    it("should preserve exact UUID values", async () => {
      const mockQuery = createMockQuery();
      neo4jService.initQuery.mockReturnValue(mockQuery);
      neo4jService.readOne.mockResolvedValue(null);

      const exactId = "123e4567-e89b-12d3-a456-426614174000";
      await repository.findByIdForUser({ notificationId: exactId, userId: TEST_IDS.userId });

      expect(mockQuery.queryParams.notificationId).toBe(exactId);
    });

    it("should handle empty notification IDs array in markAsRead", async () => {
      const mockQuery = createMockQuery();
      neo4jService.initQuery.mockReturnValue(mockQuery);
      neo4jService.writeOne.mockResolvedValue(undefined);

      await repository.markAsRead({ userId: TEST_IDS.userId, notificationIds: [] });

      expect(mockQuery.queryParams.notificationIds).toEqual([]);
    });
  });
});
