import { describe, expect, it } from "vitest";
import * as z from "zod";

import {
  convertZodToDraftJsonSchema,
  convertZodToJsonSchema,
  isStrictStructuredOutputCompatible,
  makeSchemaStrictCompatible,
  stripSyntheticNulls,
} from "../schema.utils";

// Draft 2020-12, NOT the openapi-3.0 converter: `LLMService` decides strict
// compatibility from `convertZodToDraftJsonSchema`, and the two dialects express
// nullability differently (`nullable: true` vs a real `{ type: "null" }` branch —
// see the converter docblocks). Asserting against the dialect production does not
// send would let a future divergence pass unnoticed.
const compatible = (schema: z.ZodType) => isStrictStructuredOutputCompatible(convertZodToDraftJsonSchema(schema));

describe("isStrictStructuredOutputCompatible", () => {
  it("accepts a schema whose every property is required", () => {
    expect(compatible(z.object({ a: z.string(), b: z.number() }))).toBe(true);
  });

  it("rejects a top-level optional field", () => {
    expect(compatible(z.object({ a: z.string(), b: z.string().optional() }))).toBe(false);
  });

  it("accepts a defaulted field — Zod still emits it as required", () => {
    // `.default()` only makes the key optional on INPUT; the emitted JSON Schema
    // lists it in `required`, so strict mode is satisfied. Only `.optional()`
    // actually removes a key from `required`.
    expect(compatible(z.object({ a: z.string(), b: z.array(z.string()).default([]) }))).toBe(true);
  });

  it("rejects an optional nested INSIDE an otherwise-complete object", () => {
    // The exact shape that broke triage: `posture.against` is optional, and the
    // provider reports only the nested violation.
    const schema = z.object({
      sufficient: z.boolean(),
      posture: z.object({ actingFor: z.string(), against: z.string().optional() }),
    });
    expect(compatible(schema)).toBe(false);
  });

  it("rejects an optional inside an array's element schema", () => {
    const schema = z.object({
      items: z.array(z.object({ id: z.string(), label: z.string().optional() })),
    });
    expect(compatible(schema)).toBe(false);
  });

  it("rejects an open record — additionalProperties cannot be false", () => {
    expect(compatible(z.object({ meta: z.record(z.string(), z.string()) }))).toBe(false);
  });

  it("accepts nullable fields, which strict mode CAN express", () => {
    expect(compatible(z.object({ a: z.string(), b: z.string().nullable() }))).toBe(true);
  });

  it("rejects the real triage schema", () => {
    const clarification = z.object({
      id: z.string(),
      question: z.string(),
      header: z.string(),
      multiSelect: z.boolean(),
      options: z.array(z.object({ label: z.string(), description: z.string() })),
    });
    const triage = z.object({
      sufficient: z.boolean(),
      questions: z.array(clarification).default([]),
      materia: z.string().optional(),
      posture: z.object({ actingFor: z.string(), against: z.string().optional() }).optional(),
      keywords: z.array(z.string()).default([]),
    });
    expect(compatible(triage)).toBe(false);
  });

  // Zod's toJSONSchema output carries a hidden non-enumerable `~standard` property;
  // LangChain detects it and RE-DERIVES the schema (draft-07, defaulted fields demoted
  // from `required`, `additionalProperties` lost) instead of forwarding it — the Azure
  // "additionalProperties is required to be supplied and to be false" 400. Our
  // converters must emit pure JSON.
  it("emits pure JSON — no hidden ~standard property for LangChain to re-derive from", () => {
    const schema = z.object({ x: z.string().default("").describe("d") });
    for (const converted of [convertZodToDraftJsonSchema(schema), convertZodToJsonSchema(schema)]) {
      expect("~standard" in converted).toBe(false);
      expect(Object.getOwnPropertyNames(converted)).not.toContain("~standard");
    }
  });

  it("rejects any schema containing a $ref — unverifiable here, and strict mode forbids $ref siblings", () => {
    expect(
      isStrictStructuredOutputCompatible({
        type: "object",
        properties: { node: { $ref: "#/$defs/node", description: "d" } },
        required: ["node"],
        additionalProperties: false,
        $defs: { node: { type: "string" } },
      }),
    ).toBe(false);
  });

  it("treats a non-object schema as compatible rather than throwing", () => {
    expect(isStrictStructuredOutputCompatible(undefined)).toBe(true);
    expect(isStrictStructuredOutputCompatible("nonsense")).toBe(true);
  });
});

describe("makeSchemaStrictCompatible + stripSyntheticNulls", () => {
  const triage = z.object({
    sufficient: z.boolean(),
    materia: z.string().optional(),
    keywords: z.array(z.string()).default([]),
    posture: z.object({ actingFor: z.string(), against: z.string().optional() }).optional(),
    note: z.string().nullable(),
  });
  const original = convertZodToDraftJsonSchema(triage);
  const strict = makeSchemaStrictCompatible(original);

  it("produces a schema strict mode accepts", () => {
    expect(isStrictStructuredOutputCompatible(strict)).toBe(true);
  });

  it("requires every key and closes the object", () => {
    expect(new Set(strict.required)).toEqual(new Set(Object.keys(strict.properties)));
    expect(strict.additionalProperties).toBe(false);
  });

  it("widens only the originally-optional keys", () => {
    expect(strict.properties.materia.anyOf).toEqual([{ type: "string" }, { type: "null" }]);
    // already required — left alone
    expect(strict.properties.sufficient.anyOf).toBeUndefined();
  });

  it("recurses into nested objects", () => {
    const posture = strict.properties.posture.anyOf[0];
    expect(new Set(posture.required)).toEqual(new Set(["actingFor", "against"]));
  });

  it("leaves a defaulted field required and non-nullable — the model MUST send an array", () => {
    // This is the guarantee the whole approach buys: `keywords` cannot come back as a
    // bare string or null, which is exactly what tool calling let the model do.
    expect(strict.properties.keywords.anyOf).toBeUndefined();
    expect(strict.properties.keywords.type).toBe("array");
    expect(strict.required).toContain("keywords");
  });

  it("round-trips: a strict payload validates against the ORIGINAL Zod schema", () => {
    // What strict mode forces the model to send when it has nothing to say. Only the
    // originally-optional keys can be null; `keywords` is required, so it must be [].
    const fromModel = { sufficient: true, materia: null, keywords: [], posture: null, note: null };
    const parsed = triage.parse(stripSyntheticNulls(fromModel, original));

    expect(parsed.materia).toBeUndefined();
    expect(parsed.posture).toBeUndefined();
    expect(parsed.keywords).toEqual([]);
    expect(parsed.note).toBeNull(); // author-declared nullable — preserved, NOT stripped
  });

  it("keeps populated values untouched", () => {
    const fromModel = {
      sufficient: false,
      materia: "lavoro",
      keywords: ["licenziamento"],
      posture: { actingFor: "Rossi", against: null },
      note: "x",
    };
    const parsed = triage.parse(stripSyntheticNulls(fromModel, original));
    expect(parsed.materia).toBe("lavoro");
    expect(parsed.posture).toEqual({ actingFor: "Rossi" });
  });
});

describe("three-way structured-output decision", () => {
  // Mirrors LLMService's decision rather than importing it — deliberately. This
  // pins the decision TABLE independently of the service, so a change to either
  // side has to be made on purpose in both.
  const decide = (schema: z.ZodType, supportsStrict: boolean) => {
    if (!supportsStrict) return "zod";
    const original = convertZodToDraftJsonSchema(schema);
    if (isStrictStructuredOutputCompatible(original)) return "zod";
    return isStrictStructuredOutputCompatible(makeSchemaStrictCompatible(original)) ? "strict" : "functionCalling";
  };

  it("passes a strict-clean schema through as zod", () => {
    expect(decide(z.object({ a: z.string() }), true)).toBe("zod");
  });

  it("rewrites an optional-bearing schema for strict mode", () => {
    expect(decide(z.object({ a: z.string(), b: z.string().optional() }), true)).toBe("strict");
  });

  it("falls back to tool calling for an open record, which strict cannot express", () => {
    expect(decide(z.object({ m: z.record(z.string(), z.string()) }), true)).toBe("functionCalling");
  });

  it("never rewrites when the provider ignores strict", () => {
    expect(decide(z.object({ a: z.string(), b: z.string().optional() }), false)).toBe("zod");
  });
});
