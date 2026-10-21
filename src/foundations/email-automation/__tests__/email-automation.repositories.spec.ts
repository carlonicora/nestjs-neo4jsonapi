import { ClsService } from "nestjs-cls";
import type { MockedObject } from "vitest";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { Neo4jService } from "../../../core/neo4j/services/neo4j.service";
import { SecurityService } from "../../../core/security/services/security.service";
import { EmailAutomationEnrollmentDescriptor } from "../entities/email-automation-enrollment";
import { EmailAutomationEnrollmentRepository } from "../repositories/email-automation-enrollment.repository";
import { EmailAutomationStepRepository } from "../repositories/email-automation-step.repository";
import { EmailOptOutRepository } from "../repositories/email-opt-out.repository";

type IssuedQuery = { query: string; queryParams: Record<string, unknown> };

describe("email-automation repositories", () => {
  // Simulates the prefix Neo4jService.initQuery() emits on an authenticated
  // request: custom Cypher must be appended to it (`+=`), never assigned over it.
  const initQueryPrefix = "MATCH (currentUser:User {id: $currentUserId})\n";

  let neo4j: MockedObject<Neo4jService>;
  let securityService: MockedObject<SecurityService>;
  let cls: MockedObject<ClsService>;
  let enrollmentRepository: EmailAutomationEnrollmentRepository;
  let stepRepository: EmailAutomationStepRepository;
  let optOutRepository: EmailOptOutRepository;

  const lastCall = (calls: unknown[][]): IssuedQuery => calls[calls.length - 1][0] as IssuedQuery;
  const lastWrite = (): IssuedQuery => lastCall(neo4j.writeOne.mock.calls);
  const lastReadMany = (): IssuedQuery => lastCall(neo4j.readMany.mock.calls);

  beforeEach(() => {
    neo4j = {
      initQuery: vi.fn((params?: any) => ({
        query: initQueryPrefix,
        queryParams: { companyId: null, currentUserId: "user-1" },
        cursor: params?.cursor,
        serialiser: params?.serialiser,
        fetchAll: params?.fetchAll,
      })),
      readOne: vi.fn(async () => null),
      readMany: vi.fn(async () => []),
      writeOne: vi.fn(async () => null),
      read: vi.fn(async () => ({ records: [] })),
      executeInTransaction: vi.fn(async () => []),
    } as unknown as MockedObject<Neo4jService>;
    securityService = {
      userHasAccess: vi.fn((params: { validator: () => string }) => params.validator()),
    } as unknown as MockedObject<SecurityService>;
    cls = { get: vi.fn(() => undefined), has: vi.fn(() => false) } as unknown as MockedObject<ClsService>;

    enrollmentRepository = new EmailAutomationEnrollmentRepository(neo4j, securityService, cls);
    stepRepository = new EmailAutomationStepRepository(neo4j, securityService, cls);
    optOutRepository = new EmailOptOutRepository(neo4j, securityService, cls);
  });

  describe("EmailAutomationEnrollmentRepository.findDue", () => {
    it("is a bounded worker query on active, due enrolments of active automations", async () => {
      const now = new Date("2026-10-21T10:00:00.000Z");

      await enrollmentRepository.findDue({ now, limit: 200 });

      const issued = lastReadMany();
      expect(issued.query.startsWith(initQueryPrefix)).toBe(true);
      expect(issued.query).toContain("LIMIT toInteger($limit)");
      expect(issued.query).not.toContain("{CURSOR}");
      expect(issued.query).toContain("datetime($now)");
      expect(issued.query).toContain("isActive = true");
      expect(issued.query).toContain("ORDER BY emailAutomationEnrollment.nextSendAt ASC");
      expect(issued.queryParams).toMatchObject({ now: now.toISOString(), limit: 200, status: "active" });
      expect(neo4j.initQuery).toHaveBeenCalledWith(
        expect.objectContaining({ serialiser: EmailAutomationEnrollmentDescriptor.model }),
      );
    });
  });

  describe("EmailAutomationEnrollmentRepository.createEnrollment", () => {
    it("creates an active enrolment linked to its automation and waiting on its step", async () => {
      const enrolledAt = new Date("2026-10-21T10:00:00.000Z");
      const nextSendAt = new Date("2026-10-22T10:00:00.000Z");

      await enrollmentRepository.createEnrollment({
        id: "enrollment-1",
        automationId: "automation-1",
        stepId: "step-1",
        recipient: {
          email: "ada@example.com",
          name: "Ada",
          recipientType: "user",
          recipientId: "user-9",
          marketingConsent: true,
        },
        enrolledAt,
        nextSendAt,
        unsubscribeToken: "token-1",
      });

      const issued = lastWrite();
      expect(issued.query.startsWith(initQueryPrefix)).toBe(true);
      expect(issued.query).toContain("datetime($enrolledAt)");
      expect(issued.query).toContain("datetime($nextSendAt)");
      expect(issued.query).toContain("HAS_ENROLLMENT");
      expect(issued.query).toContain("AT_STEP");
      expect(issued.queryParams).toMatchObject({
        id: "enrollment-1",
        automationId: "automation-1",
        stepId: "step-1",
        email: "ada@example.com",
        name: "Ada",
        recipientType: "user",
        recipientId: "user-9",
        status: "active",
        enrolledAt: enrolledAt.toISOString(),
        nextSendAt: nextSendAt.toISOString(),
        unsubscribeToken: "token-1",
      });
    });
  });

  describe("EmailAutomationEnrollmentRepository.markSent", () => {
    it("merges the SENT edge with a cast sentAt", async () => {
      const sentAt = new Date("2026-10-21T11:00:00.000Z");

      await enrollmentRepository.markSent({ enrollmentId: "enrollment-1", stepId: "step-1", sentAt });

      const issued = lastWrite();
      expect(issued.query).toContain("MERGE");
      expect(issued.query).toContain("SENT");
      expect(issued.query).toContain("datetime($sentAt)");
      expect(issued.queryParams).toMatchObject({
        enrollmentId: "enrollment-1",
        stepId: "step-1",
        sentAt: sentAt.toISOString(),
      });
    });
  });

  describe("EmailAutomationEnrollmentRepository.findByAutomation", () => {
    it("paginates with the {CURSOR} placeholder, newest first", async () => {
      const cursor = { cursor: undefined, take: 25 } as any;

      await enrollmentRepository.findByAutomation({ automationId: "automation-1", status: "active", cursor });

      const issued = lastReadMany();
      expect(issued.query).toContain("{CURSOR}");
      expect(issued.query).toContain("ORDER BY emailAutomationEnrollment.enrolledAt DESC");
      expect(issued.query).toContain("emailAutomationEnrollment.status = $status");
      expect(issued.queryParams).toMatchObject({ automationId: "automation-1", status: "active" });
      expect(neo4j.initQuery).toHaveBeenCalledWith(expect.objectContaining({ cursor }));
    });

    it("omits the status filter when no status is given", async () => {
      await enrollmentRepository.findByAutomation({ automationId: "automation-1", cursor: {} as any });

      expect(lastReadMany().query).not.toContain("emailAutomationEnrollment.status = $status");
    });
  });

  describe("EmailAutomationStepRepository.setNext", () => {
    it("only deletes the outgoing NEXT link when nextStepId is null", async () => {
      await stepRepository.setNext({ stepId: "step-1", nextStepId: null });

      const issued = lastWrite();
      expect(issued.query.startsWith(initQueryPrefix)).toBe(true);
      expect(issued.query).toContain("DELETE");
      expect(issued.query).not.toContain("MERGE");
    });

    it("deletes the existing link, then merges the new one", async () => {
      await stepRepository.setNext({ stepId: "step-1", nextStepId: "step-2" });

      const issued = lastWrite();
      expect(issued.query).toContain("DELETE");
      expect(issued.query).toContain("MERGE");
      expect(issued.query.indexOf("DELETE")).toBeLessThan(issued.query.indexOf("MERGE"));
      expect(issued.queryParams).toMatchObject({ stepId: "step-1", nextStepId: "step-2" });
    });
  });

  describe("EmailOptOutRepository.createOptOut", () => {
    it("merges on the lower-cased email with a cast optedOutAt", async () => {
      const optedOutAt = new Date("2026-10-21T12:00:00.000Z");

      await optOutRepository.createOptOut({
        id: "opt-out-1",
        email: "Ada@Example.com",
        optedOutAt,
        source: "link",
      });

      const issued = lastWrite();
      expect(issued.query).toContain("MERGE");
      expect(issued.query).toContain("toLower");
      expect(issued.query).toContain("datetime($optedOutAt)");
      expect(issued.queryParams).toMatchObject({
        id: "opt-out-1",
        email: "Ada@Example.com",
        optedOutAt: optedOutAt.toISOString(),
        source: "link",
      });
    });
  });
});
