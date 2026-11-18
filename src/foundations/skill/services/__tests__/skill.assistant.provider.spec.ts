import { beforeEach, describe, expect, it, Mocked, vi } from "vitest";
import { SkillRepository } from "../../repositories/skill.repository";
import { SkillAssistantProvider } from "../skill.assistant.provider";

const repository = {
  findActiveForCompany: vi.fn(),
  findActiveByNames: vi.fn(),
} as unknown as Mocked<SkillRepository>;

describe("SkillAssistantProvider", () => {
  let provider: SkillAssistantProvider;

  beforeEach(() => {
    vi.clearAllMocks();
    provider = new SkillAssistantProvider(repository);
  });

  it("lists the active skills as name and description", async () => {
    repository.findActiveForCompany.mockResolvedValue([
      { id: "1", name: "a", description: "da", instructions: "ia" },
      { id: "2", name: "b", description: "db", instructions: "ib" },
    ] as any);
    expect(await provider.listActive()).toEqual([
      { name: "a", description: "da" },
      { name: "b", description: "db" },
    ]);
  });

  it("loads the named skills in one read, keeping the rows found only", async () => {
    repository.findActiveByNames.mockResolvedValue([
      { id: "1", name: "a", description: "da", instructions: "ia" },
    ] as any);
    expect(await provider.load({ names: ["a", "b"] })).toEqual([{ name: "a", instructions: "ia" }]);
    expect(repository.findActiveByNames).toHaveBeenCalledTimes(1);
    expect(repository.findActiveByNames).toHaveBeenCalledWith({ names: ["a", "b"] });
  });

  it("reads nothing when no name is asked", async () => {
    expect(await provider.load({ names: [] })).toEqual([]);
    expect(repository.findActiveByNames).not.toHaveBeenCalled();
  });
});
