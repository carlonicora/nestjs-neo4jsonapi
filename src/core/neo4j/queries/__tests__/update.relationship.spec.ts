import { describe, it, expect } from "vitest";
import { updateRelationshipQuery } from "../update.relationship";

describe("updateRelationshipQuery", () => {
  describe("Scenario: Self-referential relationship collision", () => {
    it("should use paramAlias when node and param names match", () => {
      const query = updateRelationshipQuery({
        node: "taxonomy",
        relationshipName: "SPECIALISES",
        relationshipToNode: true,
        label: "Taxonomy",
        param: "taxonomy",
        values: ["id-1", "id-2"],
      });

      expect(query).toContain("$taxonomy_ids AS taxonomy_ids");
      expect(query).toContain("UNWIND taxonomy_ids AS id");
      expect(query).toContain("WHERE NOT existing.id IN $taxonomy_ids");
      expect(query).not.toContain("$taxonomy AS taxonomy");
    });

    it("should handle case-insensitive collision detection", () => {
      const query = updateRelationshipQuery({
        node: "Taxonomy",
        relationshipName: "SPECIALISES",
        relationshipToNode: true,
        label: "Taxonomy",
        param: "taxonomy",
        values: ["id-1"],
      });

      expect(query).toContain("taxonomy_ids");
    });
  });

  describe("Scenario: Non-colliding parameters", () => {
    it("should not apply alias when node and param names differ", () => {
      const query = updateRelationshipQuery({
        node: "skill",
        relationshipName: "HAS_TAXONOMY",
        relationshipToNode: true,
        label: "Taxonomy",
        param: "taxonomy",
        values: ["id-1", "id-2"],
      });

      expect(query).toContain("$taxonomy AS taxonomy");
      expect(query).toContain("UNWIND taxonomy AS id");
      expect(query).not.toContain("taxonomy_ids");
    });
  });

  describe("Scenario: Empty values with collision", () => {
    it("should handle empty values array with self-referential params", () => {
      const query = updateRelationshipQuery({
        node: "taxonomy",
        relationshipName: "SPECIALISES",
        relationshipToNode: true,
        label: "Taxonomy",
        param: "taxonomy",
        values: [],
      });

      expect(query).toContain("WHERE NOT existing.id IN $taxonomy_ids");
      expect(query).not.toContain("UNWIND");
    });
  });

  describe("Scenario: Relationship properties with collision", () => {
    it("should use aliased propertiesMapParam when collision exists", () => {
      const query = updateRelationshipQuery({
        node: "taxonomy",
        relationshipName: "SPECIALISES",
        relationshipToNode: true,
        label: "Taxonomy",
        param: "taxonomy",
        values: ["id-1"],
        relationshipProperties: [{ position: 1 }],
        queryParams: {},
      });

      expect(query).toContain("taxonomy_ids");
      expect(query).toContain("SET");
    });
  });

  describe("Scenario: queryParams synchronization with collision", () => {
    it("should sync queryParams when collision exists", () => {
      const queryParams: Record<string, string[]> = { taxonomy: ["id-1", "id-2"] };

      updateRelationshipQuery({
        node: "taxonomy",
        relationshipName: "SPECIALISES",
        relationshipToNode: true,
        label: "Taxonomy",
        param: "taxonomy",
        values: ["id-1", "id-2"],
        queryParams,
      });

      expect(queryParams.taxonomy_ids).toEqual(["id-1", "id-2"]);
    });

    it("should not modify queryParams when no collision exists", () => {
      const queryParams: Record<string, string[]> = { taxonomy: ["id-1", "id-2"] };

      updateRelationshipQuery({
        node: "skill",
        relationshipName: "HAS_TAXONOMY",
        relationshipToNode: true,
        label: "Taxonomy",
        param: "taxonomy",
        values: ["id-1", "id-2"],
        queryParams,
      });

      expect(queryParams.taxonomy_ids).toBeUndefined();
      expect(queryParams.taxonomy).toEqual(["id-1", "id-2"]);
    });

    it("should handle queryParams with empty values when collision exists", () => {
      const queryParams: Record<string, string[]> = { taxonomy: [] };

      updateRelationshipQuery({
        node: "taxonomy",
        relationshipName: "SPECIALISES",
        relationshipToNode: true,
        label: "Taxonomy",
        param: "taxonomy",
        values: [],
        queryParams,
      });

      expect(queryParams.taxonomy_ids).toEqual([]);
    });
  });

  describe("Scenario: companyScoped targets", () => {
    const base = {
      node: "account",
      relationshipName: "HAS_ACCESS",
      relationshipToNode: true,
      label: "User",
      param: "userIds",
      values: ["u1"],
    };

    it("does not filter targets by company by default", () => {
      const query = updateRelationshipQuery(base);

      expect(query).toContain("MATCH (new:User {id: id})");
      expect(query).not.toContain("BELONGS_TO");
    });

    it("links only targets that BELONG_TO $companyId when opted in", () => {
      const query = updateRelationshipQuery({ ...base, companyScoped: true });

      expect(query).toMatch(
        /MATCH \(new:User \{id: id\}\)\s+WHERE EXISTS \{ \(new\)-\[:BELONGS_TO\]->\(:Company \{id: \$companyId\}\) \}\s+MERGE/,
      );
    });

    it("keeps removing edges to ids no longer listed, whatever their company", () => {
      const query = updateRelationshipQuery({ ...base, companyScoped: true });

      expect(query).toContain("WHERE NOT existing.id IN $userIds");
      expect(query).toContain("DELETE rel");
    });
  });
});
