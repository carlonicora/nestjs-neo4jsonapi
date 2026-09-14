import { describe, expect, it } from "vitest";
import { handbookPageMeta } from "../handbook-page.meta";
import { HandbookThreadDescriptor } from "../handbook-thread";
import { handbookThreadMeta } from "../handbook-thread.meta";
import { HandbookThreadMessageDescriptor } from "../handbook-thread-message";
import { handbookThreadMessageMeta } from "../handbook-thread-message.meta";

describe("HandbookThreadDescriptor", () => {
  // Load-bearing, not incidental: a platform administrator has a Membership
  // with HAS_ROLE and no IN_COMPANY, so a company-scoped thread would 404 for
  // exactly the user the feature exists for. This is why the feature does not
  // reuse the package Assistant, which IS company-scoped.
  it("is NOT company scoped", () => {
    expect(HandbookThreadDescriptor.isCompanyScoped).toBe(false);
  });

  it("carries the thread meta", () => {
    expect(handbookThreadMeta.type).toBe("handbookthreads");
    expect(handbookThreadMeta.endpoint).toBe("handbookthreads");
    expect(handbookThreadMeta.nodeName).toBe("handbookThread");
    expect(handbookThreadMeta.labelName).toBe("HandbookThread");
    expect(HandbookThreadDescriptor.model.labelName).toBe("HandbookThread");
  });

  it("declares title as its only, required field", () => {
    expect(Object.keys(HandbookThreadDescriptor.fields)).toEqual(["title"]);
    expect((HandbookThreadDescriptor.fields.title as { required?: boolean }).required).toBe(true);
  });

  // The owner edge is the ENTIRE security boundary for this entity — there is
  // no company filter behind it. `contextKey` attaches it from CLS so a client
  // can never nominate a different owner, and `immutable` stops a later PUT
  // from re-pointing it.
  it("owns its threads through a CREATED_BY edge taken from CLS and never writable by a client", () => {
    const owner = HandbookThreadDescriptor.relationships.owner;

    expect(owner.relationship).toBe("CREATED_BY");
    expect(owner.direction).toBe("out");
    expect(owner.cardinality).toBe("one");
    expect(owner.contextKey).toBe("userId");
    expect(owner.immutable).toBe(true);
  });

  it("holds its messages on an outgoing HAS_MESSAGE edge", () => {
    const messages = HandbookThreadDescriptor.relationships.messages;

    expect(messages.relationship).toBe("HAS_MESSAGE");
    expect(messages.direction).toBe("out");
    expect(messages.cardinality).toBe("many");
    expect(messages.model.type).toBe(handbookThreadMessageMeta.type);
  });
});

describe("HandbookThreadMessageDescriptor", () => {
  it("is NOT company scoped", () => {
    expect(HandbookThreadMessageDescriptor.isCompanyScoped).toBe(false);
  });

  it("carries the message meta", () => {
    expect(handbookThreadMessageMeta.type).toBe("handbookthreadmessages");
    expect(handbookThreadMessageMeta.endpoint).toBe("handbookthreadmessages");
    expect(handbookThreadMessageMeta.nodeName).toBe("handbookThreadMessage");
    expect(handbookThreadMessageMeta.labelName).toBe("HandbookThreadMessage");
  });

  it("declares exactly role, content, position and sources", () => {
    expect(Object.keys(HandbookThreadMessageDescriptor.fields).sort()).toEqual([
      "content",
      "position",
      "role",
      "sources",
    ]);
    expect((HandbookThreadMessageDescriptor.fields.role as { required?: boolean }).required).toBe(true);
    expect((HandbookThreadMessageDescriptor.fields.content as { required?: boolean }).required).toBe(true);
    expect((HandbookThreadMessageDescriptor.fields.position as { required?: boolean }).required).toBe(true);
  });

  it("stores sources as a string array — repo-relative handbook page paths", () => {
    expect((HandbookThreadMessageDescriptor.fields.sources as { type: string }).type).toBe("string[]");
  });

  it("belongs to its thread on the incoming side of the same HAS_MESSAGE edge", () => {
    const thread = HandbookThreadMessageDescriptor.relationships.thread;

    expect(thread.relationship).toBe("HAS_MESSAGE");
    expect(thread.direction).toBe("in");
    expect(thread.cardinality).toBe("one");
    expect(thread.required).toBe(true);
    expect(thread.immutable).toBe(true);
    expect(thread.model.type).toBe(handbookThreadMeta.type);
  });

  // modelRegistry is keyed by nodeName: a collision would silently shadow one
  // descriptor with the other and break `include:` resolution at runtime.
  it("uses nodeNames that collide with no other handbook descriptor", () => {
    const nodeNames = [handbookPageMeta.nodeName, handbookThreadMeta.nodeName, handbookThreadMessageMeta.nodeName];
    expect(new Set(nodeNames).size).toBe(nodeNames.length);
  });
});
