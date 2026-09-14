import { describe, it, expect } from "vitest";
import type { Document } from "@langchain/core/documents";
import { dropEmptyChunkDocuments } from "../chunk-content.util";

const doc = (pageContent: string): Document => ({ pageContent, metadata: {} }) as Document;

describe("dropEmptyChunkDocuments", () => {
  it("keeps documents that carry text", () => {
    const documents = [doc("first"), doc("second")];
    expect(dropEmptyChunkDocuments(documents)).toEqual(documents);
  });

  it("drops empty and whitespace-only documents", () => {
    const kept = doc("real content");
    expect(dropEmptyChunkDocuments([doc(""), kept, doc("   "), doc("\n\t  \r\n")])).toEqual([kept]);
  });

  it("returns an empty array when every document is blank", () => {
    expect(dropEmptyChunkDocuments([doc(""), doc(" \n ")])).toEqual([]);
  });

  it("returns an empty array for an empty input", () => {
    expect(dropEmptyChunkDocuments([])).toEqual([]);
  });

  it("does not mutate the input array", () => {
    const documents = [doc(""), doc("kept")];
    dropEmptyChunkDocuments(documents);
    expect(documents).toHaveLength(2);
  });
});
