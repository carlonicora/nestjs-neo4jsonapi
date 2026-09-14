import { beforeEach, describe, expect, it, vi } from "vitest";
import { HandbookSectionRepository } from "../handbook-section.repository";

// Same doubles as the sibling handbook-page.repository.spec.ts: `initQuery`
// hands back a bare query envelope, `read` answers SHOW INDEXES with an empty
// record set, and ClsService answers `get` because `buildDefaultMatch()` reads
// companyId/userId off it even for a global entity.
function makeNeo4j() {
  return {
    initQuery: vi.fn(() => ({ query: "", queryParams: {} })),
    writeOne: vi.fn(async (_query: any) => undefined),
    read: vi.fn(async (_query: string, _params?: any) => ({ records: [] as any[] })),
    readOne: vi.fn(async (_query: any) => null),
    readMany: vi.fn(async (_query: any) => []),
  };
}

describe("HandbookSectionRepository", () => {
  let neo4j: ReturnType<typeof makeNeo4j>;
  let repository: HandbookSectionRepository;

  beforeEach(() => {
    neo4j = makeNeo4j();
    const clsService = { get: vi.fn(() => undefined), set: vi.fn() };
    repository = new HandbookSectionRepository(neo4j as any, {} as any, clsService as any);
  });

  it("declares a uniqueness constraint on key and delegates to super.onModuleInit", async () => {
    const superInit = vi
      .spyOn(Object.getPrototypeOf(Object.getPrototypeOf(repository)), "onModuleInit")
      .mockResolvedValue(undefined);

    await repository.onModuleInit();

    expect(superInit).toHaveBeenCalled();
    expect(neo4j.writeOne).toHaveBeenCalledWith(
      expect.objectContaining({ query: expect.stringContaining("handbooksection_key") }),
    );

    superInit.mockRestore();
  });

  it("orders findAllSections by order", async () => {
    await repository.findAllSections();
    expect(neo4j.readMany).toHaveBeenCalledWith(
      expect.objectContaining({ query: expect.stringContaining("ORDER BY handbookSection.order ASC") }),
    );
  });

  it("reads through the serialiser, never raw records", async () => {
    await repository.findAllSections();
    expect(neo4j.initQuery).toHaveBeenCalledWith(expect.objectContaining({ serialiser: expect.anything() }));
  });

  it("replaceAll deletes every section then writes the supplied rows in one parameterised query", async () => {
    await repository.replaceAll({
      sections: [{ id: "s1", key: "03-backend", title: "Backend", summary: "The API", order: "03-backend" }],
    });

    const call = neo4j.writeOne.mock.calls.at(-1)![0] as any;
    expect(call.query).toContain("DETACH DELETE");
    expect(call.query).toContain("UNWIND $sections AS section");
    expect(call.query).not.toContain("03-backend");
    expect(call.queryParams.sections).toHaveLength(1);
  });

  it("replaceAll writes the display title and summary of each section", async () => {
    await repository.replaceAll({
      sections: [
        {
          id: "s1",
          key: "03-backend",
          title: "Backend",
          summary: "The API and how it is built.",
          order: "03-backend",
          displayTitle: "Backend",
          displaySummary: "L'API e come è costruita.",
        },
      ],
    });

    const call = neo4j.writeOne.mock.calls.at(-1)![0] as any;
    expect(call.query).toContain("displayTitle: section.displayTitle");
    expect(call.query).toContain("displaySummary: section.displaySummary");
    expect(call.query).not.toContain("L'API e come è costruita.");
    expect(call.queryParams.sections[0]).toMatchObject({
      displayTitle: "Backend",
      displaySummary: "L'API e come è costruita.",
    });
  });

  it("replaceAll binds an untranslated section's display fields as null", async () => {
    await repository.replaceAll({
      sections: [{ id: "s1", key: "03-backend", title: "Backend", order: "03-backend" }],
    });

    const section = (neo4j.writeOne.mock.calls.at(-1)![0] as any).queryParams.sections[0];
    expect(section.summary).toBeNull();
    expect(section.displayTitle).toBeNull();
    expect(section.displaySummary).toBeNull();
  });
});
