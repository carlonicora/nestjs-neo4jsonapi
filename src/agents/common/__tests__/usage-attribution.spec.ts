import { describe, expect, it, vi, beforeEach } from "vitest";
import { Logger } from "@nestjs/common";
import {
  buildCallerAttribution,
  buildEmbedderAttribution,
  buildInheritedAttribution,
  buildInheritedEmbedderAttribution,
  buildRetrievalAttribution,
  buildScopeAttribution,
  classifyCallerAttribution,
  resolveScopeLabel,
} from "../usage-attribution";
import { modelRegistry } from "../../../common/registries/registry";

describe("usage attribution", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    modelRegistry.register({ nodeName: "campaign", labelName: "Campaign", type: "campaigns" } as any);
  });

  describe("resolveScopeLabel", () => {
    it("translates a JSON:API type into its Neo4j label", () => {
      expect(resolveScopeLabel("campaigns")).toBe("Campaign");
    });

    it("returns undefined — and WARNS — for a type no model claims", () => {
      const warn = vi.spyOn(Logger.prototype, "warn").mockImplementation(() => undefined);

      expect(resolveScopeLabel("widgets")).toBeUndefined();

      expect(warn).toHaveBeenCalledTimes(1);
      expect(String(warn.mock.calls[0][0])).toContain("widgets");
    });

    it("returns undefined without warning when there is no type at all", () => {
      const warn = vi.spyOn(Logger.prototype, "warn").mockImplementation(() => undefined);

      expect(resolveScopeLabel(undefined)).toBeUndefined();

      expect(warn).not.toHaveBeenCalled();
    });
  });

  describe("buildScopeAttribution", () => {
    it("prefers the scope root, using the label the caller already resolved", () => {
      expect(
        buildScopeAttribution({
          tokenUsageType: "responder",
          scopeId: "campaign-1",
          scopeType: "campaigns",
          scopeLabel: "Campaign",
          assistantId: "assistant-1",
        }),
      ).toEqual({ tokenUsageType: "responder", relationshipId: "campaign-1", relationshipType: "Campaign" });
    });

    it("falls back to the registry when the caller supplies only the JSON:API type", () => {
      expect(
        buildScopeAttribution({ tokenUsageType: "responder", scopeId: "campaign-1", scopeType: "campaigns" }),
      ).toEqual({ tokenUsageType: "responder", relationshipId: "campaign-1", relationshipType: "Campaign" });
    });

    it("falls back to the assistant thread when the turn has no scope root", () => {
      expect(buildScopeAttribution({ tokenUsageType: "operator", assistantId: "assistant-1" })).toEqual({
        tokenUsageType: "operator",
        relationshipId: "assistant-1",
        relationshipType: "Assistant",
      });
    });

    it("falls back to the thread rather than recording nothing when the label cannot be resolved", () => {
      vi.spyOn(Logger.prototype, "warn").mockImplementation(() => undefined);

      expect(
        buildScopeAttribution({
          tokenUsageType: "responder",
          scopeId: "widget-1",
          scopeType: "widgets",
          assistantId: "assistant-1",
        }),
      ).toEqual({ tokenUsageType: "responder", relationshipId: "assistant-1", relationshipType: "Assistant" });
    });

    it("returns no relationship at all when neither a scope nor a thread is supplied", () => {
      expect(buildScopeAttribution({ tokenUsageType: "responder" })).toEqual({ tokenUsageType: "responder" });
    });
  });

  describe("buildEmbedderAttribution", () => {
    it("translates a JSON:API type into the Neo4j label the USED_FOR edge is matched on", () => {
      expect(buildEmbedderAttribution({ entityId: "campaign-1", entityIdentifier: "campaigns" })).toEqual({
        relationshipId: "campaign-1",
        relationshipType: "Campaign",
      });
    });

    it("passes a label straight through", () => {
      expect(buildEmbedderAttribution({ entityId: "campaign-1", entityIdentifier: "Campaign" })).toEqual({
        relationshipId: "campaign-1",
        relationshipType: "Campaign",
      });
    });

    it("falls back to the identifier itself — and WARNS — when no model claims it", () => {
      // Ingestion call sites already interpolate the same value into Cypher as a
      // label, so an unregistered identifier is still the right label there. At the
      // QUERY-time sites it is a JSON:API type and would match nothing, so the
      // fallback must never be silent.
      const warn = vi.spyOn(Logger.prototype, "warn").mockImplementation(() => undefined);

      expect(buildEmbedderAttribution({ entityId: "widget-1", entityIdentifier: "Widget" })).toEqual({
        relationshipId: "widget-1",
        relationshipType: "Widget",
      });

      expect(warn).toHaveBeenCalledTimes(1);
      expect(String(warn.mock.calls[0][0])).toContain("Widget");
    });

    it("does NOT warn when the identifier resolves", () => {
      const warn = vi.spyOn(Logger.prototype, "warn").mockImplementation(() => undefined);

      buildEmbedderAttribution({ entityId: "campaign-1", entityIdentifier: "campaigns" });
      buildEmbedderAttribution({ entityId: "campaign-1", entityIdentifier: "Campaign" });

      expect(warn).not.toHaveBeenCalled();
    });

    it("carries an explicit tokenUsageType when the caller overrides the default", () => {
      expect(
        buildEmbedderAttribution({ entityId: "campaign-1", entityIdentifier: "campaigns", tokenUsageType: "custom" }),
      ).toEqual({ relationshipId: "campaign-1", relationshipType: "Campaign", tokenUsageType: "custom" });
    });

    it("returns undefined — recording nothing — when either half is missing", () => {
      expect(buildEmbedderAttribution({ entityIdentifier: "campaigns" })).toBeUndefined();
      expect(buildEmbedderAttribution({ entityId: "campaign-1" })).toBeUndefined();
      expect(buildEmbedderAttribution({ entityId: "", entityIdentifier: "" })).toBeUndefined();
    });
  });

  describe("buildRetrievalAttribution", () => {
    it("bills a retrieval to the content the run is bound to", () => {
      expect(buildRetrievalAttribution({ contentId: "campaign-1", contentType: "campaigns", dataLimits: {} })).toEqual({
        relationshipId: "campaign-1",
        relationshipType: "Campaign",
      });
    });

    it("bills a help-mode retrieval to the HowTo it is limited to, without warning", () => {
      // howToMeta.labelName IS the label — nothing to resolve, so no false alarm.
      const warn = vi.spyOn(Logger.prototype, "warn").mockImplementation(() => undefined);

      expect(buildRetrievalAttribution({ dataLimits: { howToMode: true, limitToHowToId: "howto-1" } })).toEqual({
        relationshipId: "howto-1",
        relationshipType: "HowTo",
      });

      expect(warn).not.toHaveBeenCalled();
    });

    it("prefers the bound content over the HowTo limit", () => {
      expect(
        buildRetrievalAttribution({
          contentId: "campaign-1",
          contentType: "campaigns",
          dataLimits: { limitToHowToId: "howto-1" },
        }),
      ).toEqual({ relationshipId: "campaign-1", relationshipType: "Campaign" });
    });

    it("records nothing for an unbound company-wide search", () => {
      // No honest entity to name — inventing one would write a USED_FOR edge
      // that matches nothing.
      expect(buildRetrievalAttribution({ contentId: "", contentType: "", dataLimits: {} })).toBeUndefined();
      expect(buildRetrievalAttribution({ dataLimits: { howToMode: true } })).toBeUndefined();
      expect(buildRetrievalAttribution({})).toBeUndefined();
    });

    it("prefers the CALLING agent's scope root over the bound content (Task 10)", () => {
      // One turn, one billed entity: the sub-agent's retrieval must not land on
      // a different entity from the calling agent's own LLM calls.
      expect(
        buildRetrievalAttribution({
          contentId: "content-1",
          contentType: "campaigns",
          dataLimits: { limitToHowToId: "howto-1" },
          scope: { scopeId: "campaign-1", scopeLabel: "Campaign" },
        }),
      ).toEqual({ relationshipId: "campaign-1", relationshipType: "Campaign" });
    });

    it("ignores an empty caller scope and falls through to the existing branches", () => {
      expect(
        buildRetrievalAttribution({ contentId: "campaign-1", contentType: "campaigns", dataLimits: {}, scope: {} }),
      ).toEqual({ relationshipId: "campaign-1", relationshipType: "Campaign" });
    });
  });

  describe("buildCallerAttribution", () => {
    it("packs the caller's own category and turn identifiers", () => {
      expect(
        buildCallerAttribution({
          tokenUsageType: "responder",
          source: { scopeId: "campaign-1", scopeType: "campaigns", scopeLabel: "Campaign", assistantId: "a-1" },
        }),
      ).toEqual({
        tokenUsageType: "responder",
        scopeId: "campaign-1",
        scopeType: "campaigns",
        scopeLabel: "Campaign",
        assistantId: "a-1",
      });
    });

    it("keeps the category even when the caller holds no identifiers", () => {
      expect(buildCallerAttribution({ tokenUsageType: "operator" })).toEqual({
        tokenUsageType: "operator",
        scopeId: undefined,
        scopeType: undefined,
        scopeLabel: undefined,
        assistantId: undefined,
      });
    });
  });

  describe("classifyCallerAttribution", () => {
    it('is "billable" when the caller named an entity the record can point at', () => {
      expect(classifyCallerAttribution({ scopeId: "campaign-1", scopeLabel: "Campaign" })).toBe("billable");
      expect(classifyCallerAttribution({ scopeId: "campaign-1", scopeType: "campaigns" })).toBe("billable");
      expect(classifyCallerAttribution({ assistantId: "a-1" })).toBe("billable");
    });

    it('is "none" when the caller named NO entity — the legitimate MCP / direct-consumer path', () => {
      // `McpUserContext` carries only userId/companyId/userModuleIds: no scope
      // root, no thread, ever. Warning here would warn on every MCP tool call.
      expect(classifyCallerAttribution(undefined)).toBe("none");
      expect(classifyCallerAttribution({})).toBe("none");
      // A category alone is NOT "naming an entity": every caller supplies one
      // unconditionally, so counting it would collapse "none" into a fault.
      expect(classifyCallerAttribution({ tokenUsageType: "operator" })).toBe("none");
    });

    it('is "unresolvable" when the caller named something that cannot be billed', () => {
      const warn = vi.spyOn(Logger.prototype, "warn").mockImplementation(() => undefined);

      // Looks attributed, records nothing — the failure the helper exists for.
      expect(classifyCallerAttribution({ scopeId: "widget-1", scopeType: "widgets" })).toBe("unresolvable");
      // Half an attribution: an id with no way to name its label.
      expect(classifyCallerAttribution({ scopeId: "campaign-1" })).toBe("unresolvable");
      // A label with no id.
      expect(classifyCallerAttribution({ scopeLabel: "Campaign" })).toBe("unresolvable");

      warn.mockRestore();
    });

    it('never consults the registry on the "none" path', () => {
      // Proven by the absence of resolveScopeLabel's warning, which every
      // unresolved lookup emits.
      const warn = vi.spyOn(Logger.prototype, "warn").mockImplementation(() => undefined);

      classifyCallerAttribution({ tokenUsageType: "operator" });

      expect(warn).not.toHaveBeenCalled();
    });
  });

  describe("buildInheritedAttribution", () => {
    it("uses the CALLER's category, never one of the sub-agent's own", () => {
      expect(
        buildInheritedAttribution({ tokenUsageType: "responder", scopeId: "campaign-1", scopeLabel: "Campaign" }),
      ).toEqual({ tokenUsageType: "responder", relationshipId: "campaign-1", relationshipType: "Campaign" });
    });

    it("translates a bare JSON:API scopeType into the label the USED_FOR edge matches", () => {
      expect(
        buildInheritedAttribution({ tokenUsageType: "operator", scopeId: "campaign-1", scopeType: "campaigns" }),
      ).toEqual({ tokenUsageType: "operator", relationshipId: "campaign-1", relationshipType: "Campaign" });
    });

    it("falls back to the library default category, not to a sub-agent name", () => {
      expect(buildInheritedAttribution({ scopeId: "campaign-1", scopeLabel: "Campaign" })).toEqual({
        tokenUsageType: "text_generation",
        relationshipId: "campaign-1",
        relationshipType: "Campaign",
      });
      expect(buildInheritedAttribution(undefined)).toEqual({ tokenUsageType: "text_generation" });
    });
  });

  describe("buildInheritedEmbedderAttribution", () => {
    it("bills an embedding to the same entity as the caller's LLM calls", () => {
      expect(
        buildInheritedEmbedderAttribution({
          tokenUsageType: "responder",
          scopeId: "campaign-1",
          scopeLabel: "Campaign",
        }),
        // No tokenUsageType: the recorder's `embedding` default classifies the
        // OPERATION; the caller's identity is the entity it points at.
      ).toEqual({ relationshipId: "campaign-1", relationshipType: "Campaign" });
    });

    it("falls back to the caller's assistant thread", () => {
      expect(buildInheritedEmbedderAttribution({ assistantId: "a-1" })).toEqual({
        relationshipId: "a-1",
        relationshipType: "Assistant",
      });
    });

    it("returns undefined — recording nothing — when the caller supplied no entity", () => {
      expect(buildInheritedEmbedderAttribution({ tokenUsageType: "responder" })).toBeUndefined();
      expect(buildInheritedEmbedderAttribution(undefined)).toBeUndefined();
    });
  });
});
