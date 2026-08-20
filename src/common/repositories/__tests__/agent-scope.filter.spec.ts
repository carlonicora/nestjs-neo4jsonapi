import { ClsService } from "nestjs-cls";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { AGENT_SCOPE_CLS_KEY, AgentScope } from "../../types/agent.scope";
import { AgentScopeFilterService } from "../agent-scope.filter";
import { ScopePredicateSource } from "../scope-predicate.source";

const SCOPE: AgentScope = { id: "root-1", type: "roots", label: "Root" };

describe("AgentScopeFilterService", () => {
  let cls: { has: ReturnType<typeof vi.fn>; get: ReturnType<typeof vi.fn>; set: ReturnType<typeof vi.fn> };
  let predicates: { build: ReturnType<typeof vi.fn> };

  const make = (params?: { withSource?: boolean }) =>
    new AgentScopeFilterService(
      cls as unknown as ClsService,
      params?.withSource === false ? undefined : (predicates as unknown as ScopePredicateSource),
    );

  /** Publishes a scope the way a turn does. */
  const publish = (scope: AgentScope | undefined) => {
    cls.has.mockImplementation((key: string) => key === AGENT_SCOPE_CLS_KEY);
    cls.get.mockImplementation((key: string) => (key === AGENT_SCOPE_CLS_KEY ? scope : undefined));
  };

  beforeEach(() => {
    cls = { has: vi.fn(() => false), get: vi.fn(), set: vi.fn() };
    predicates = { build: vi.fn(() => ({ cypher: "(data:Root)", params: { agentScopeId: "root-1" } })) };
  });

  describe("unscoped runs", () => {
    it("filters nothing when no scope is published", () => {
      const result = make().build({ alias: "data" });

      expect(result).toEqual({ cypher: "", params: {}, applied: false });
      expect(predicates.build).not.toHaveBeenCalled();
    });

    it("filters nothing when the published scope is incomplete", () => {
      publish({ id: "", type: "roots", label: "Root" });

      expect(make().build({ alias: "data" }).applied).toBe(false);
    });

    // HowTo content is global and has no scope root, so help mode is
    // scope-independent by design rather than by oversight.
    it.each([{ howToMode: true }, { limitToHowToId: "howto-1" }])(
      "bypasses scope for HowTo runs (%o)",
      (dataLimits) => {
        publish(SCOPE);

        const result = make().build({ alias: "data", dataLimits });

        expect(result.applied).toBe(false);
        expect(predicates.build).not.toHaveBeenCalled();
      },
    );
  });

  describe("scoped runs", () => {
    beforeEach(() => publish(SCOPE));

    it("emits the compiled predicate as a WHERE clause", () => {
      const result = make().build({ alias: "data" });

      expect(result).toEqual({ cypher: "WHERE (data:Root)", params: { agentScopeId: "root-1" }, applied: true });
      expect(predicates.build).toHaveBeenCalledWith({ alias: "data", scope: SCOPE });
    });

    it("exposes the bare expression for callers that cannot use a standalone WHERE", () => {
      expect(make().predicate({ alias: "data" })?.cypher).toBe("(data:Root)");
    });

    it("reports the current scope to callers that build their own Cypher", () => {
      expect(make().current()).toEqual(SCOPE);
    });
  });

  // The whole point of the guard: a run that declares a scope it cannot enforce
  // must retrieve NOTHING. Returning an empty filter here would silently restore
  // company-wide retrieval — the exact leak this exists to prevent.
  describe("fail-closed", () => {
    beforeEach(() => publish(SCOPE));

    it("emits WHERE false when no predicate source is registered", () => {
      const result = make({ withSource: false }).build({ alias: "data" });

      expect(result).toEqual({ cypher: "WHERE false", params: {}, applied: true });
    });

    it("emits WHERE false when nothing in the catalog can reach the root", () => {
      predicates.build.mockReturnValue(null);

      expect(make().build({ alias: "data" }).cypher).toBe("WHERE false");
    });

    it("never returns an empty filter for a scoped run", () => {
      predicates.build.mockReturnValue(null);

      const result = make().build({ alias: "data" });

      expect(result.cypher).not.toBe("");
      expect(result.applied).toBe(true);
    });
  });
});
