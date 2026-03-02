import { describe, it, expect } from "vitest";

interface RelationshipInfo {
  targetEntity: string;
  direction: "in" | "out";
  relationship: string;
  fieldName: string;
}

function bfsToUser(graph: Map<string, RelationshipInfo[]>, startEntity: string, maxDepth: number): string[] {
  if (startEntity === "User") return [];

  const paths: string[] = [];
  const queue: Array<{ entity: string; path: string[]; depth: number }> = [{ entity: startEntity, path: [], depth: 0 }];
  const visited = new Set<string>();
  visited.add(startEntity);

  while (queue.length > 0) {
    const { entity, path: currentPath, depth } = queue.shift()!;
    if (depth >= maxDepth) continue;

    const relationships = graph.get(entity) ?? [];
    for (const rel of relationships) {
      if (visited.has(rel.targetEntity) && rel.targetEntity !== "User") continue;

      const newPath = [...currentPath, rel.fieldName];

      if (rel.targetEntity === "User") {
        paths.push(newPath.join("."));
      } else {
        visited.add(rel.targetEntity);
        queue.push({
          entity: rel.targetEntity,
          path: newPath,
          depth: depth + 1,
        });
      }
    }
  }

  return paths;
}

describe("bfsToUser", () => {
  it("should find direct path to User", () => {
    const graph = new Map<string, RelationshipInfo[]>();
    graph.set("Pipeline", [{ targetEntity: "User", direction: "in", relationship: "CREATED", fieldName: "owner" }]);

    const result = bfsToUser(graph, "Pipeline", 4);
    expect(result).toEqual(["owner"]);
  });

  it("should find indirect path through intermediate entity", () => {
    const graph = new Map<string, RelationshipInfo[]>();
    graph.set("Task", [{ targetEntity: "Project", direction: "in", relationship: "IN_PROJECT", fieldName: "project" }]);
    graph.set("Project", [{ targetEntity: "User", direction: "in", relationship: "CREATED", fieldName: "owner" }]);

    const result = bfsToUser(graph, "Task", 4);
    expect(result).toEqual(["project.owner"]);
  });

  it("should find multiple paths to User", () => {
    const graph = new Map<string, RelationshipInfo[]>();
    graph.set("Pipeline", [
      { targetEntity: "User", direction: "in", relationship: "CREATED", fieldName: "owner" },
      { targetEntity: "Company", direction: "out", relationship: "BELONGS_TO", fieldName: "company" },
    ]);
    graph.set("Company", [{ targetEntity: "User", direction: "in", relationship: "MEMBER_OF", fieldName: "user" }]);

    const result = bfsToUser(graph, "Pipeline", 4);
    expect(result).toContain("owner");
    expect(result).toContain("company.user");
  });

  it("should handle cycles without infinite loop", () => {
    const graph = new Map<string, RelationshipInfo[]>();
    graph.set("A", [{ targetEntity: "B", direction: "out", relationship: "REL", fieldName: "b" }]);
    graph.set("B", [
      { targetEntity: "A", direction: "out", relationship: "REL", fieldName: "a" },
      { targetEntity: "User", direction: "in", relationship: "CREATED", fieldName: "owner" },
    ]);

    const result = bfsToUser(graph, "A", 4);
    expect(result).toEqual(["b.owner"]);
  });

  it("should respect max depth limit", () => {
    const graph = new Map<string, RelationshipInfo[]>();
    graph.set("A", [{ targetEntity: "B", direction: "out", relationship: "REL", fieldName: "b" }]);
    graph.set("B", [{ targetEntity: "C", direction: "out", relationship: "REL", fieldName: "c" }]);
    graph.set("C", [{ targetEntity: "User", direction: "in", relationship: "CREATED", fieldName: "owner" }]);

    const resultShort = bfsToUser(graph, "A", 2);
    expect(resultShort).toEqual([]);

    const resultLong = bfsToUser(graph, "A", 3);
    expect(resultLong).toEqual(["b.c.owner"]);
  });

  it("should return empty array when starting from User", () => {
    const graph = new Map<string, RelationshipInfo[]>();
    const result = bfsToUser(graph, "User", 4);
    expect(result).toEqual([]);
  });

  it("should return empty array when no path to User exists", () => {
    const graph = new Map<string, RelationshipInfo[]>();
    graph.set("Isolated", [{ targetEntity: "Other", direction: "out", relationship: "REL", fieldName: "other" }]);
    graph.set("Other", []);

    const result = bfsToUser(graph, "Isolated", 4);
    expect(result).toEqual([]);
  });
});
