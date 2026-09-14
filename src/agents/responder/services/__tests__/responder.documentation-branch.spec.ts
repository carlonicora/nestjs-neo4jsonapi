import { describe, expect, it } from "vitest";
import { usesDocumentationBranch } from "../responder.service";

describe("usesDocumentationBranch", () => {
  it("fires for how-to mode", () => {
    expect(usesDocumentationBranch({ howToMode: true })).toBe(true);
    expect(usesDocumentationBranch({ limitToHowToId: "h1" })).toBe(true);
  });

  it("fires for handbook mode", () => {
    expect(usesDocumentationBranch({ handbookMode: true })).toBe(true);
    expect(usesDocumentationBranch({ limitToHandbookPageId: "p1" })).toBe(true);
  });

  it("does not fire for ordinary retrieval", () => {
    expect(usesDocumentationBranch({})).toBe(false);
    expect(usesDocumentationBranch({ proceedingId: "p1" } as any)).toBe(false);
  });
});
