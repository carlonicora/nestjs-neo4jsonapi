import { BadRequestException } from "@nestjs/common";
import { describe, expect, it, vi } from "vitest";
import { parseJsonApiSort } from "../../../core/neo4j/helpers/parse-jsonapi-sort";
import { HowToController } from "../controllers/how-to.controller";
import { HowToDescriptor } from "../entities/how-to";

/** Column sorting on the how-to list (spec row A19): name. */

describe("HowToController sort", () => {
  it("findAll forwards sort and the legacy orderBy (call C10)", async () => {
    const service = { find: vi.fn().mockResolvedValue({}) };
    const controller = new HowToController(service as any, {} as any, {} as any);
    await controller.findAll({ send: vi.fn() } as any, {}, undefined, undefined, "name", "-name");
    expect(service.find).toHaveBeenCalledWith(expect.objectContaining({ sort: "-name", orderBy: "name" }));
  });
});

describe("HowTo descriptor sortable fields", () => {
  it("accepts name", () => {
    expect(parseJsonApiSort({ sort: "-name", descriptor: HowToDescriptor })).toEqual([
      { field: "name", direction: "desc" },
    ]);
  });

  it.each(["pages", "description", "name) DETACH DELETE n //"])("refuses %s with a 400", (sort) => {
    expect(() => parseJsonApiSort({ sort, descriptor: HowToDescriptor })).toThrow(BadRequestException);
  });
});
