import "reflect-metadata";
import { plainToInstance } from "class-transformer";
import { validate, ValidationError } from "class-validator";
import { describe, expect, it } from "vitest";
import { assistantMeta } from "../../entities/assistant.meta";
import { AssistantAppendDto } from "../assistant-append.dto";
import { AssistantPostDto } from "../assistant-post.dto";

/** Every constraint name reported anywhere in the error tree. */
const constraintsOf = (errors: ValidationError[]): string[] =>
  errors.flatMap((error) => [...Object.keys(error.constraints ?? {}), ...constraintsOf(error.children ?? [])]);

const append = (attributes: Record<string, unknown>) =>
  validate(plainToInstance(AssistantAppendDto, { data: { type: "assistant-messages", attributes } }));

const post = (attributes: Record<string, unknown>) =>
  validate(plainToInstance(AssistantPostDto, { data: { type: assistantMeta.endpoint, attributes } }));

describe("assistant DTOs: clientContext", () => {
  it('AssistantAppendDto accepts clientContext { a: "1" }', async () => {
    expect(await append({ content: "hi", clientContext: { a: "1" } })).toEqual([]);
  });

  it("AssistantAppendDto accepts no clientContext", async () => {
    expect(await append({ content: "hi" })).toEqual([]);
  });

  it("AssistantAppendDto rejects clientContext { a: 1 }", async () => {
    const errors = await append({ content: "hi", clientContext: { a: 1 } });
    expect(constraintsOf(errors)).toContain("assistantClientContext");
  });

  it("AssistantAppendDto rejects 9 keys", async () => {
    const clientContext = Object.fromEntries(Array.from({ length: 9 }, (_, index) => [`k${index}`, "v"]));
    const errors = await append({ content: "hi", clientContext });
    expect(constraintsOf(errors)).toContain("assistantClientContext");
  });

  it("AssistantPostDto rejects an array clientContext", async () => {
    const errors = await post({ content: "hi", clientContext: ["a"] });
    expect(constraintsOf(errors)).toContain("assistantClientContext");
  });

  it('AssistantPostDto accepts clientContext { a: "1" }', async () => {
    expect(await post({ content: "hi", clientContext: { a: "1" } })).toEqual([]);
  });
});
