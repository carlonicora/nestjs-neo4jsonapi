import { BadRequestException } from "@nestjs/common";
import { describe, expect, it, vi } from "vitest";
import { parseJsonApiSort } from "../../../core/neo4j/helpers/parse-jsonapi-sort";
import { BlogCategoryController } from "../controllers/blog-category.controller";
import { BlogPostController } from "../controllers/blog-post.controller";
import { BlogPostDescriptor } from "../entities/blog-post";
import { BlogCategoryRepository } from "../repositories/blog-category.repository";
import { BlogPostRepository } from "../repositories/blog-post.repository";

/**
 * Column sorting on the blog admin lists (spec rows A14, A18): posts sort by status and
 * publishedAt; categories have no own sortable column. Both search branches keep the sort.
 */

const reply = { send: vi.fn() } as any;

describe("Blog controllers sort", () => {
  it("BlogPostController.findAll forwards sort and the legacy orderBy (call C10)", async () => {
    const service = { find: vi.fn().mockResolvedValue({}) };
    const controller = new BlogPostController(service as any, {} as any, {} as any);
    await controller.findAll(reply, {}, undefined, undefined, "status", "-publishedAt");
    expect(service.find).toHaveBeenCalledWith(expect.objectContaining({ sort: "-publishedAt", orderBy: "status" }));
  });

  it("BlogCategoryController.findAll forwards sort", async () => {
    const service = { find: vi.fn().mockResolvedValue({}) };
    const controller = new BlogCategoryController(service as any, {} as any, {} as any);
    await controller.findAll(reply, {}, undefined, undefined, undefined, "-updatedAt");
    expect(service.find).toHaveBeenCalledWith(expect.objectContaining({ sort: "-updatedAt" }));
  });
});

describe("BlogPost descriptor sortable fields", () => {
  it("accepts status and publishedAt", () => {
    expect(parseJsonApiSort({ sort: "status,-publishedAt", descriptor: BlogPostDescriptor })).toHaveLength(2);
  });

  it.each(["originalLanguage", "coverImage", "title"])("refuses %s with a 400", (field) => {
    expect(() => parseJsonApiSort({ sort: field, descriptor: BlogPostDescriptor })).toThrow(BadRequestException);
  });
});

describe.each([
  ["BlogPostRepository", BlogPostRepository, "blogPost"],
  ["BlogCategoryRepository", BlogCategoryRepository, "blogCategory"],
] as const)("%s.find search branch sort (call C7)", (_name, Repository, alias) => {
  function setup() {
    const neo4j = {
      initQuery: vi.fn(() => ({ query: "", queryParams: {} as Record<string, any> })),
      readMany: vi.fn().mockResolvedValue([]),
    };
    const repository = new (Repository as any)(neo4j, {}, { get: vi.fn() });
    vi.spyOn(repository, "buildDefaultMatch").mockReturnValue(`MATCH (${alias})`);
    vi.spyOn(repository, "buildReturnStatement").mockReturnValue(`RETURN ${alias}`);
    return { repository, query: () => neo4j.readMany.mock.calls[0][0].query as string };
  }

  it("puts the sort before the score, then the id, before {CURSOR}", async () => {
    const { repository, query } = setup();
    await repository.find({ term: "x", orderByFields: [{ field: "updatedAt", direction: "asc" }] });
    expect(query()).toContain(`ORDER BY ${alias}.updatedAt ASC, score DESC, ${alias}.id ASC`);
    expect(query().indexOf("{CURSOR}")).toBeGreaterThan(query().indexOf("ORDER BY"));
  });

  it("keeps the score order without a sort", async () => {
    const { repository, query } = setup();
    await repository.find({ term: "x" });
    expect(query()).toContain(`ORDER BY score DESC, ${alias}.id ASC`);
  });
});
