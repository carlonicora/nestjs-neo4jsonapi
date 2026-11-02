import "reflect-metadata";
import { plainToInstance } from "class-transformer";
import { validate } from "class-validator";
import { describe, expect, it } from "vitest";
import { OfflineChangeSetPostDTO } from "../offline-change-set.post.dto";

const document = (changes: unknown[]) => ({
  data: {
    type: "offline-change-sets",
    id: "6f1c1f8e-3d2a-4b8e-9a51-1f0d6c2b7e10",
    attributes: { changes },
  },
});

const errorsOf = async (plain: unknown) => validate(plainToInstance(OfflineChangeSetPostDTO, plain));

const flatten = (errors: any[]): string[] =>
  errors.flatMap((e) => [...Object.keys(e.constraints ?? {}), ...flatten(e.children ?? [])]);

describe("OfflineChangeSetPostDTO", () => {
  it("accepts a valid package", async () => {
    const errors = await errorsOf(
      document([
        { seq: 1, method: "POST", path: "npcs", body: { data: { type: "npcs", id: "n1" } } },
        {
          seq: 2,
          method: "PATCH",
          path: "npcs/n1",
          body: { data: { type: "npcs", id: "n1" } },
          recordType: "npcs",
          recordId: "n1",
          base: { type: "npcs", id: "n1", attributes: {} },
          resolution: { kind: "merged" },
        },
      ]),
    );
    expect(errors).toEqual([]);
  });

  it("rejects a change without seq/method/path", async () => {
    const errors = await errorsOf(document([{ body: {} }]));
    const constraints = flatten(errors);
    expect(constraints).toEqual(expect.arrayContaining(["isDefined"]));
    const change = errors[0].children[0].children[0].children[0];
    expect(change.children.map((c: any) => c.property).sort()).toEqual(["method", "path", "seq"]);
  });

  it("rejects a method outside the four", async () => {
    const errors = await errorsOf(document([{ seq: 1, method: "GET", path: "npcs" }]));
    expect(flatten(errors)).toEqual(["isIn"]);
  });

  it("rejects a package of another type", async () => {
    const plain = document([]);
    plain.data.type = "npcs";
    expect(flatten(await errorsOf(plain))).toEqual(["equals"]);
  });

  const resolved = (resolution: unknown) =>
    document([
      {
        seq: 1,
        method: "PATCH",
        path: "npcs/n1",
        body: { data: { type: "npcs", id: "n1" } },
        recordType: "npcs",
        recordId: "n1",
        base: { type: "npcs", id: "n1", attributes: {} },
        resolution,
      },
    ]);

  it("accepts a resolution with per-field choices and a merged body", async () => {
    const errors = await errorsOf(
      resolved({
        kind: "merged",
        choices: { name: "mine", level: "theirs", description: "merged" },
        mergedBody: { data: { type: "npcs", id: "n1", attributes: { description: "[]" } } },
      }),
    );
    expect(errors).toEqual([]);
  });

  it("rejects a choice outside mine/theirs/merged and a non-object merged body", async () => {
    expect(flatten(await errorsOf(resolved({ kind: "merged", choices: { name: "both" } })))).toEqual([
      "isOfflineFieldChoices",
    ]);
    expect(flatten(await errorsOf(resolved({ kind: "merged", mergedBody: "x" })))).toEqual(["isObject"]);
  });
});
