import "reflect-metadata";
import { plainToInstance } from "class-transformer";
import { validateSync } from "class-validator";
import { describe, expect, it } from "vitest";
import { SkillPostDTO } from "../skill.post.dto";

const ID = "11111111-1111-4111-8111-111111111111";
const ORIGINAL_ID = "22222222-2222-4222-8222-222222222222";

const body = (attributes: Record<string, unknown>, relationships?: Record<string, unknown>) => ({
  data: {
    type: "skills",
    id: ID,
    attributes: { name: "quote", description: "Writes a quote.", instructions: "Do it.", ...attributes },
    ...(relationships ? { relationships } : {}),
  },
});

const errorsOf = (input: unknown) => validateSync(plainToInstance(SkillPostDTO, input) as object);

describe("SkillPostDTO", () => {
  it("accepts a valid skill at the limits", () => {
    expect(errorsOf(body({ description: "d".repeat(200), instructions: "i".repeat(20000) }))).toEqual([]);
  });

  it.each(["Q", "q", "Quote", "1quote", "quote_x", "a".repeat(41)])("rejects the name %s", (name) => {
    expect(errorsOf(body({ name })).length).toBeGreaterThan(0);
  });

  it("rejects a description of 201 characters or empty", () => {
    expect(errorsOf(body({ description: "d".repeat(201) })).length).toBeGreaterThan(0);
    expect(errorsOf(body({ description: "" })).length).toBeGreaterThan(0);
  });

  it("rejects instructions of 20,001 characters or empty", () => {
    expect(errorsOf(body({ instructions: "i".repeat(20001) })).length).toBeGreaterThan(0);
    expect(errorsOf(body({ instructions: "" })).length).toBeGreaterThan(0);
  });

  it("accepts an optional original relationship", () => {
    expect(errorsOf(body({}, { original: { data: { type: "skills", id: ORIGINAL_ID } } }))).toEqual([]);
  });

  it("rejects an original relationship of the wrong type", () => {
    expect(errorsOf(body({}, { original: { data: { type: "howtos", id: ORIGINAL_ID } } })).length).toBeGreaterThan(0);
  });
});
