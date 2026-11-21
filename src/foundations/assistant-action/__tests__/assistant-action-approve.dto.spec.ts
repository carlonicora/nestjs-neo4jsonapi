import "reflect-metadata";
import { ValidationPipe } from "@nestjs/common";
import { plainToInstance } from "class-transformer";
import { validate, ValidationError } from "class-validator";
import { describe, expect, it } from "vitest";
import { AssistantActionApproveDto } from "../dtos/assistant-action-approve.dto";
import { assistantActionMeta } from "../entities/assistant-action.meta";

const ID = "8b0f5e9a-3c2d-4e1f-9a8b-7c6d5e4f3a2b";

const constraintsOf = (errors: ValidationError[]): string[] =>
  errors.flatMap((error) => [...Object.keys(error.constraints ?? {}), ...constraintsOf(error.children ?? [])]);

const check = (body: unknown) => validate(plainToInstance(AssistantActionApproveDto, body as object));

describe("AssistantActionApproveDto", () => {
  it("accepts an empty body", async () => {
    expect(await check({})).toEqual([]);
  });

  it("accepts data without attributes, and attributes without edits", async () => {
    expect(await check({ data: { type: assistantActionMeta.endpoint, id: ID } })).toEqual([]);
    expect(await check({ data: { type: assistantActionMeta.endpoint, id: ID, attributes: {} } })).toEqual([]);
  });

  it("accepts edits of string values, including {}", async () => {
    for (const edits of [{}, { name: "Zed", description: '[{"type":"paragraph"}]' }]) {
      expect(await check({ data: { type: assistantActionMeta.endpoint, id: ID, attributes: { edits } } })).toEqual([]);
    }
  });

  it("rejects a non-string edit value, an array and a non-object", async () => {
    for (const edits of [{ name: 1 }, ["a"], "name"]) {
      const errors = await check({ data: { type: assistantActionMeta.endpoint, id: ID, attributes: { edits } } });
      expect(constraintsOf(errors)).toContain("assistantActionEdits");
    }
  });

  it("rejects the wrong type and a missing id", async () => {
    expect(constraintsOf(await check({ data: { type: "npcs", id: ID } }))).toContain("equals");
    expect(constraintsOf(await check({ data: { type: assistantActionMeta.endpoint } }))).toContain("isUuid");
  });

  it("passes the global pipe with no body at all, and keeps the edit keys through whitelisting", async () => {
    const pipe = new ValidationPipe({ whitelist: true, transform: true, validateCustomDecorators: true });
    const metadata = { type: "body" as const, metatype: AssistantActionApproveDto, data: undefined };

    // No body passes validation and carries no data, so the controller approves as today.
    const empty = await pipe.transform(undefined, metadata);
    expect(empty?.data).toBeUndefined();

    const body = { data: { type: assistantActionMeta.endpoint, id: ID, attributes: { edits: { name: "Zed" } } } };
    const transformed = await pipe.transform(body, metadata);
    expect(transformed.data.attributes.edits).toEqual({ name: "Zed" });
  });
});
