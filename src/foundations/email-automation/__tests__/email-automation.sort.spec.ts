import { BadRequestException } from "@nestjs/common";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { parseJsonApiSort } from "../../../core/neo4j/helpers/parse-jsonapi-sort";
import { EmailAutomationController } from "../controllers/email-automation.controller";
import { EmailAutomationDescriptor } from "../entities/email-automation";
import { EmailAutomationEnrollmentRepository } from "../repositories/email-automation-enrollment.repository";
import { EmailAutomationService } from "../services/email-automation.service";

/**
 * Column sorting on the email automation lists (spec rows A4, A5): the automations list
 * sorts by name, purpose, trigger, isActive (never the computed counts); the recipients list
 * by email, name, status, nextSendAt (never the computed step or sent count).
 */

describe("EmailAutomation descriptor sortable fields", () => {
  it("accepts the stored columns", () => {
    expect(
      parseJsonApiSort({ sort: "name,-purpose,trigger,isActive", descriptor: EmailAutomationDescriptor }),
    ).toHaveLength(4);
  });

  it.each(["stepCount", "activeCount", "completedCount", "unsubscribedCount"])(
    "refuses the computed count %s with a 400",
    (field) => {
      expect(() => parseJsonApiSort({ sort: field, descriptor: EmailAutomationDescriptor })).toThrow(
        BadRequestException,
      );
    },
  );
});

describe("EmailAutomationController sort", () => {
  let service: { find: ReturnType<typeof vi.fn>; findEnrollments: ReturnType<typeof vi.fn> };
  let controller: EmailAutomationController;
  const reply = { send: vi.fn() } as any;

  beforeEach(() => {
    service = { find: vi.fn().mockResolvedValue({}), findEnrollments: vi.fn().mockResolvedValue({}) };
    controller = new EmailAutomationController(service as any, {} as any, {} as any, {} as any);
  });

  it("findAll forwards sort and still forwards the legacy orderBy (call C10)", async () => {
    await controller.findAll(reply, {}, undefined, undefined, "name DESC", "-name");
    expect(service.find).toHaveBeenCalledWith(expect.objectContaining({ sort: "-name", orderBy: "name DESC" }));
  });

  it("findEnrollments forwards sort", async () => {
    await controller.findEnrollments(reply, "automation-1", {}, undefined, "nextSendAt");
    expect(service.findEnrollments).toHaveBeenCalledWith(expect.objectContaining({ sort: "nextSendAt" }));
  });
});

describe("EmailAutomationService.findEnrollments sort", () => {
  let enrollmentRepository: { findByAutomation: ReturnType<typeof vi.fn> };
  let service: EmailAutomationService;

  beforeEach(() => {
    enrollmentRepository = { findByAutomation: vi.fn().mockResolvedValue([]) };
    service = Object.assign(Object.create(EmailAutomationService.prototype), {
      enrollmentRepository,
      jsonApiService: { buildList: vi.fn().mockResolvedValue({ data: [] }) },
    });
  });

  it("passes the validated sort to the repository", async () => {
    await service.findEnrollments({ id: "a", query: {}, sort: "-nextSendAt,email" });
    expect(enrollmentRepository.findByAutomation.mock.calls[0][0].orderByFields).toEqual([
      { field: "nextSendAt", direction: "desc" },
      { field: "email", direction: "asc" },
    ]);
  });

  it("refuses a hostile or computed sort with a 400 before any query", async () => {
    for (const sort of ["email) DETACH DELETE n //", "sentCount", "currentStepSubject", "unsubscribeToken"]) {
      await expect(service.findEnrollments({ id: "a", query: {}, sort })).rejects.toThrow(BadRequestException);
    }
    expect(enrollmentRepository.findByAutomation).not.toHaveBeenCalled();
  });
});

describe("EmailAutomationEnrollmentRepository.findByAutomation sort", () => {
  function setup() {
    const neo4j = {
      initQuery: vi.fn(() => ({ query: "", queryParams: {} as Record<string, any> })),
      readMany: vi.fn().mockResolvedValue([]),
    };
    const repository = new EmailAutomationEnrollmentRepository(neo4j as any, {} as any, { get: vi.fn() } as any);
    vi.spyOn(repository as any, "buildDefaultMatch").mockReturnValue("MATCH (emailAutomationEnrollment)");
    vi.spyOn(repository as any, "buildReturnStatement").mockReturnValue("RETURN emailAutomationEnrollment");
    return { repository, query: () => neo4j.readMany.mock.calls[0][0].query as string };
  }

  it("orders by the requested sort, then the id, before {CURSOR}", async () => {
    const { repository, query } = setup();
    await repository.findByAutomation({
      automationId: "a",
      cursor: {} as any,
      orderByFields: [{ field: "status", direction: "asc" }],
    });
    expect(query()).toContain(
      "ORDER BY CASE WHEN emailAutomationEnrollment.status IS :: STRING THEN toLower(emailAutomationEnrollment.status) ELSE emailAutomationEnrollment.status END ASC, emailAutomationEnrollment.id ASC",
    );
    expect(query().indexOf("{CURSOR}")).toBeGreaterThan(query().indexOf("ORDER BY"));
  });

  it("keeps enrolledAt DESC as its default", async () => {
    const { repository, query } = setup();
    await repository.findByAutomation({ automationId: "a", cursor: {} as any });
    expect(query()).toContain("ORDER BY emailAutomationEnrollment.enrolledAt DESC, emailAutomationEnrollment.id ASC");
  });
});
