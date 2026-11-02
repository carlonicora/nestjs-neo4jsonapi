import { ClsService } from "nestjs-cls";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Mocked } from "vitest";
import { JsonApiCursorInterface } from "../../../core/jsonapi/interfaces/jsonapi.cursor.interface";
import { Neo4jService } from "../../../core/neo4j/services/neo4j.service";
import { SecurityService } from "../../../core/security/services/security.service";
import { EmailAutomationCandidateDescriptor } from "../entities/email-automation-candidate";
import { emailAutomationCandidateMeta } from "../entities/email-automation-candidate.meta";
import { EmailAutomationCandidateRepository } from "../repositories/email-automation-candidate.repository";
import { recipientMarketingConsentCall } from "../utils/recipient-marketing-consent.cypher";

/** What initQuery prepends for an administrator who belongs to a company. */
const CONTEXT_PREFIX =
  "MATCH (company:Company {id: $companyId}) MATCH (currentUser:User {id: $currentUserId})-[:BELONGS_TO]->(company)";

const alias = emailAutomationCandidateMeta.nodeName;

/** How the candidate queries call the shared consent rule. */
const CONSENT_ARGS = {
  carry: `${alias}, recipientType, recipientId`,
  recipientType: "recipientType",
  recipientId: "recipientId",
  prefix: alias,
};

const record = (values: Record<string, unknown>) => ({
  has: (key: string) => key in values,
  get: (key: string) => values[key],
  keys: Object.keys(values),
});

describe("EmailAutomationCandidateRepository", () => {
  let neo4j: Mocked<Neo4jService>;
  let repository: EmailAutomationCandidateRepository;
  const cursor: JsonApiCursorInterface = { cursor: 25, take: 26 };

  const issued = (method: "readMany" | "readOne") => neo4j[method].mock.calls[0][0] as any;

  beforeEach(() => {
    neo4j = {
      initQuery: vi.fn((params?: any) => ({
        query: CONTEXT_PREFIX,
        queryParams: { companyId: "company-1", currentUserId: "admin-1" },
        cursor: params?.cursor,
        serialiser: params?.serialiser,
      })),
      read: vi.fn(),
      readOne: vi.fn().mockResolvedValue(null),
      readMany: vi.fn().mockResolvedValue([]),
    } as unknown as Mocked<Neo4jService>;
    const securityService = {} as unknown as Mocked<SecurityService>;
    const cls = { get: vi.fn(() => "company-1"), has: vi.fn(() => true) } as unknown as Mocked<ClsService>;

    repository = new EmailAutomationCandidateRepository(neo4j, securityService, cls);
  });

  describe("findCandidates", () => {
    it("seeds the query with initQuery, the serialiser and the cursor, and reads through readMany", async () => {
      await repository.findCandidates({ automationId: "auto-1", search: "Ann", cursor });

      expect(neo4j.initQuery).toHaveBeenCalledWith({ serialiser: EmailAutomationCandidateDescriptor.model, cursor });
      expect(neo4j.readMany).toHaveBeenCalledTimes(1);
      expect(neo4j.read).not.toHaveBeenCalled();
      expect(issued("readMany").cursor).toBe(cursor);
      expect(issued("readMany").serialiser).toBe(EmailAutomationCandidateDescriptor.model);
    });

    it("appends to the initQuery context instead of replacing it", async () => {
      await repository.findCandidates({ automationId: "auto-1", cursor });

      expect(issued("readMany").query.startsWith(CONTEXT_PREFIX)).toBe(true);
      expect(issued("readMany").queryParams).toMatchObject({ companyId: "company-1", currentUserId: "admin-1" });
    });

    it("paginates through {CURSOR}, never a hand-written SKIP or LIMIT", async () => {
      await repository.findCandidates({ automationId: "auto-1", cursor });

      const query: string = issued("readMany").query;
      expect(query).toContain("{CURSOR}");
      expect(query).not.toMatch(/\bLIMIT\b/);
      expect(query).not.toMatch(/\bSKIP\b/);
      expect(issued("readMany").queryParams).not.toHaveProperty("limit");
    });

    it("unions users and confirmed or invited waitlist entries under the candidate alias", async () => {
      await repository.findCandidates({ automationId: "auto-1", search: "Ann", cursor });

      const { query, queryParams } = issued("readMany");
      expect(query).toContain("UNION");
      expect(query).toContain(`RETURN user AS ${alias}`);
      expect(query).toContain(`RETURN waitlist AS ${alias}`);
      expect(query).toContain("user.isActive = true");
      expect(query).toContain("coalesce(user.isDeleted, false) = false");
      expect(query).toContain("user.deletionScheduledAt IS NULL");
      expect(query).toContain('trim(user.email) <> ""');
      expect(query).toContain('toLower(coalesce(user.name, "")) CONTAINS toLower($search)');
      expect(query).toContain("waitlist.status IN $waitlistStatuses");
      expect(query).toContain('trim(waitlist.email) <> ""');
      expect(query).toContain("toLower(waitlist.email) CONTAINS toLower($search)");
      expect(queryParams).toMatchObject({
        automationId: "auto-1",
        search: "Ann",
        waitlistStatuses: ["confirmed", "invited"],
      });
    });

    it("orders by email, then pages, then computes the flags", async () => {
      await repository.findCandidates({ automationId: "auto-1", cursor });

      const query: string = issued("readMany").query;
      const orderAt = query.indexOf(`ORDER BY toLower(${alias}.email)`);
      const cursorAt = query.indexOf("{CURSOR}");
      const optOutAt = query.indexOf("EmailOptOut");
      const enrolledAt = query.indexOf("HAS_ENROLLMENT");

      expect(orderAt).toBeGreaterThan(-1);
      expect(cursorAt).toBeGreaterThan(orderAt);
      expect(optOutAt).toBeGreaterThan(cursorAt);
      expect(enrolledAt).toBeGreaterThan(cursorAt);
      expect(query).toMatch(
        new RegExp(
          `RETURN ${alias},\\s+recipientType,\\s+recipientId,\\s+recipientMarketingConsent AS marketingConsent,`,
        ),
      );
      expect(query).toContain("AS optedOut");
      expect(query).toContain("AS alreadyEnrolled");
    });

    it("follows the waitlist userId to the linked user's consent, through the shared consent rule", async () => {
      await repository.findCandidates({ automationId: "auto-1", cursor });

      const query: string = issued("readMany").query;
      expect(query).toContain(recipientMarketingConsentCall(CONSENT_ARGS));
      expect(query).toContain("recipientWaitlist.userId IS NOT NULL");
      expect(query).toContain("coalesce(linkedUser.marketingConsent, false)");
      expect(query).toContain("coalesce(recipientWaitlist.marketingConsent, false)");
    });

    it("computes the consent after the page is cut, so only the page's rows are looked up", async () => {
      await repository.findCandidates({ automationId: "auto-1", cursor });

      const query: string = issued("readMany").query;
      expect(query.indexOf("AS recipientMarketingConsent")).toBeGreaterThan(query.indexOf("{CURSOR}"));
    });

    it("never references the context company or current user, so the prepended MATCH cannot filter rows", async () => {
      await repository.findCandidates({ automationId: "auto-1", cursor });

      const appended: string = issued("readMany").query.slice(CONTEXT_PREFIX.length);
      expect(appended).not.toMatch(/\bcompany\b/);
      expect(appended).not.toMatch(/\bcurrentUser\b/);
      expect(appended).not.toContain("$companyId");
    });

    it("has no backtick in the Cypher", async () => {
      await repository.findCandidates({ automationId: "auto-1", cursor });

      expect(issued("readMany").query).not.toContain("`");
    });
  });

  describe("findCandidate", () => {
    it("reads one waitlist entry through readOne with the serialiser and no cursor", async () => {
      await repository.findCandidate({ automationId: "auto-1", recipientType: "waitlist", recipientId: "wl-1" });

      expect(neo4j.initQuery).toHaveBeenCalledWith({ serialiser: EmailAutomationCandidateDescriptor.model });
      expect(neo4j.readOne).toHaveBeenCalledTimes(1);
      const { query, queryParams } = issued("readOne");
      expect(query.startsWith(CONTEXT_PREFIX)).toBe(true);
      expect(query).toContain("waitlist.id = $recipientId");
      expect(query).not.toContain("UNION");
      expect(query).not.toContain("{CURSOR}");
      expect(query).not.toMatch(/\bLIMIT\b/);
      expect(query).not.toContain("`");
      expect(queryParams).toMatchObject({ automationId: "auto-1", recipientId: "wl-1" });
    });

    it("reads one user by id", async () => {
      await repository.findCandidate({ automationId: "auto-1", recipientType: "user", recipientId: "u-1" });

      expect(issued("readOne").query).toContain("user.id = $recipientId");
    });

    it("returns null for an unknown recipient type without querying", async () => {
      const result = await repository.findCandidate({
        automationId: "auto-1",
        recipientType: "other" as never,
        recipientId: "x",
      });

      expect(result).toBeNull();
      expect(neo4j.readOne).not.toHaveBeenCalled();
    });
  });
});

describe("EmailAutomationCandidateRepository.findRecipientMarketingConsent", () => {
  let neo4j: Mocked<Neo4jService>;
  let repository: EmailAutomationCandidateRepository;

  const issued = () => neo4j.readOne.mock.calls[0][0] as any;

  beforeEach(() => {
    neo4j = {
      initQuery: vi.fn((params?: any) => ({
        query: CONTEXT_PREFIX,
        queryParams: { companyId: "company-1", currentUserId: "admin-1" },
        cursor: params?.cursor,
        serialiser: params?.serialiser,
      })),
      read: vi.fn(),
      readOne: vi.fn().mockResolvedValue(null),
      readMany: vi.fn().mockResolvedValue([]),
    } as unknown as Mocked<Neo4jService>;
    repository = new EmailAutomationCandidateRepository(
      neo4j,
      {} as unknown as Mocked<SecurityService>,
      { get: vi.fn(), has: vi.fn(() => false) } as unknown as Mocked<ClsService>,
    );
  });

  it("reads the waitlist record through readOne with the serialiser and the shared consent rule", async () => {
    neo4j.readOne.mockResolvedValue({ id: "wl-1", marketingConsent: false } as never);

    const consent = await repository.findRecipientMarketingConsent({ recipientType: "waitlist", recipientId: "wl-1" });

    expect(consent).toBe(false);
    expect(neo4j.initQuery).toHaveBeenCalledWith({ serialiser: EmailAutomationCandidateDescriptor.model });
    expect(neo4j.read).not.toHaveBeenCalled();
    const { query, queryParams } = issued();
    expect(query.startsWith(CONTEXT_PREFIX)).toBe(true);
    expect(query).toContain(`MATCH (${alias}:Waitlist {id: $recipientId})`);
    expect(query).toContain(recipientMarketingConsentCall(CONSENT_ARGS));
    expect(query).toContain("recipientMarketingConsent AS marketingConsent");
    expect(query).not.toContain("{CURSOR}");
    expect(query).not.toMatch(/\bLIMIT\b/);
    expect(query).not.toMatch(/\bSKIP\b/);
    expect(query).not.toContain("`");
    expect(queryParams).toMatchObject({ recipientType: "waitlist", recipientId: "wl-1" });
  });

  it("matches a user by id and answers its consent", async () => {
    neo4j.readOne.mockResolvedValue({ id: "u-1", marketingConsent: true } as never);

    await expect(repository.findRecipientMarketingConsent({ recipientType: "user", recipientId: "u-1" })).resolves.toBe(
      true,
    );
    expect(issued().query).toContain(`MATCH (${alias}:User {id: $recipientId})`);
  });

  it("answers false when the record no longer exists", async () => {
    await expect(
      repository.findRecipientMarketingConsent({ recipientType: "waitlist", recipientId: "gone" }),
    ).resolves.toBe(false);
  });

  it("answers false for an unknown recipient type without querying", async () => {
    await expect(
      repository.findRecipientMarketingConsent({ recipientType: "other" as never, recipientId: "x" }),
    ).resolves.toBe(false);
    expect(neo4j.readOne).not.toHaveBeenCalled();
  });
});

describe("EmailAutomationCandidateDescriptor mapper", () => {
  const map = (node: Record<string, unknown>, labels: string[], columns: Record<string, unknown>) =>
    EmailAutomationCandidateDescriptor.model.mapper({
      data: { ...node, labels },
      record: record({ [alias]: { properties: node, labels }, ...columns }),
      entityFactory: undefined,
      name: alias,
    });

  it("maps a User node plus the record columns", () => {
    const candidate = map({ id: "u-1", email: "ann@example.com", name: "Ann", marketingConsent: true }, ["User"], {
      recipientType: "user",
      recipientId: "u-1",
      marketingConsent: false,
      optedOut: true,
      alreadyEnrolled: false,
    });

    expect(candidate).toMatchObject({
      id: "u-1",
      recipientType: "user",
      recipientId: "u-1",
      email: "ann@example.com",
      name: "Ann",
      marketingConsent: false,
      optedOut: true,
      alreadyEnrolled: false,
    });
  });

  it("maps a Waitlist node without a name", () => {
    const candidate = map({ id: "wl-1", email: "bob@example.com" }, ["Waitlist"], {
      recipientType: "waitlist",
      recipientId: "wl-1",
      marketingConsent: true,
      optedOut: null,
      alreadyEnrolled: true,
    });

    expect(candidate).toMatchObject({
      id: "wl-1",
      recipientType: "waitlist",
      recipientId: "wl-1",
      email: "bob@example.com",
      marketingConsent: true,
      optedOut: false,
      alreadyEnrolled: true,
    });
    expect(candidate.name).toBeUndefined();
  });

  it("serialises as email-automation-candidates", () => {
    expect(EmailAutomationCandidateDescriptor.model.type).toBe("email-automation-candidates");
  });
});
