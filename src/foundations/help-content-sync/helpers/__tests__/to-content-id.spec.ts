import { describe, it, expect } from "vitest";
import { toContentId } from "../to-content-id";

const NAMESPACE = "0c5d1a2e-9c7f-4a8b-9b3c-4f7e8d2a1b6f";

describe("toContentId", () => {
  it("is deterministic across calls", () => {
    expect(toContentId("how-to", "add-an-npc", NAMESPACE)).toEqual(toContentId("how-to", "add-an-npc", NAMESPACE));
  });

  it("differs between modes for the same slug", () => {
    expect(toContentId("how-to", "x", NAMESPACE)).not.toEqual(toContentId("tutorial", "x", NAMESPACE));
  });

  it("differs between namespaces for the same input", () => {
    const a = toContentId("how-to", "x", NAMESPACE);
    const b = toContentId("how-to", "x", "11111111-1111-5111-8111-111111111111");
    expect(a).not.toEqual(b);
  });

  it("emits canonical v5 UUID format", () => {
    const id = toContentId("how-to", "add-an-npc", NAMESPACE);
    expect(id).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-5[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
  });
});
