import { BadRequestException } from "@nestjs/common";
import { describe, expect, it, vi } from "vitest";
import { parseJsonApiSort } from "../../../core/neo4j/helpers/parse-jsonapi-sort";
import { EmailBlastController } from "../controllers/email-blast.controller";
import { EmailBlastDescriptor } from "../entities/email-blast";

/** Column sorting on the email blasts list (spec row A17). */

describe("EmailBlastController sort", () => {
  it("findAll forwards sort and the legacy orderBy (call C10)", async () => {
    const service = { find: vi.fn().mockResolvedValue({}) };
    const controller = new EmailBlastController(service as any, {} as any, {} as any);
    await controller.findAll({ send: vi.fn() } as any, {}, undefined, undefined, "subject", "-sentAt");
    expect(service.find).toHaveBeenCalledWith(expect.objectContaining({ sort: "-sentAt", orderBy: "subject" }));
  });
});

describe("EmailBlast descriptor sortable fields", () => {
  it("accepts the list's stored columns", () => {
    expect(
      parseJsonApiSort({
        sort: "subject,purpose,status,-sentAt,sentCount",
        descriptor: EmailBlastDescriptor,
      }),
    ).toHaveLength(5);
    expect(parseJsonApiSort({ sort: "failedCount,unsubscribedCount", descriptor: EmailBlastDescriptor })).toHaveLength(
      2,
    );
  });

  it.each(["body", "replyTo", "recipientCount"])("refuses %s with a 400", (field) => {
    expect(() => parseJsonApiSort({ sort: field, descriptor: EmailBlastDescriptor })).toThrow(BadRequestException);
  });
});
