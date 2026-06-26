import { ZodType, ZodTypeAny } from "zod";

// Minimal synthetic value for a Zod schema, used by MOCK_AI to stand in for real LLM
// structured output. Smallest valid shape: strings -> "mock", numbers -> 0, arrays -> one
// element (so downstream that iterates still creates a node), objects -> recurse.
//
// NOTE: implemented against the Zod v4 internal API (`_def.type` string discriminators).
export function mockFromZodSchema<T>(schema: ZodType<T>): T {
  return sample(schema as ZodTypeAny) as T;
}

function sample(schema: ZodTypeAny): unknown {
  const def = schema._def as { type: string; [k: string]: unknown };
  switch (def.type) {
    case "object": {
      const rawShape = def.shape as Record<string, ZodTypeAny> | (() => Record<string, ZodTypeAny>);
      const shape = typeof rawShape === "function" ? rawShape() : rawShape;
      const out: Record<string, unknown> = {};
      for (const key of Object.keys(shape)) out[key] = sample(shape[key]);
      return out;
    }
    case "array":
      return [sample(def.element as ZodTypeAny)];
    case "string":
      return "mock";
    case "number":
      return 0;
    case "boolean":
      return false;
    case "enum":
      return Object.values(def.entries as Record<string, unknown>)[0];
    case "literal":
      return (def.values as unknown[])[0];
    case "optional":
    case "nullable":
    case "default":
      return sample(def.innerType as ZodTypeAny);
    case "pipe":
      return sample(def.out as ZodTypeAny);
    case "union":
      return sample((def.options as ZodTypeAny[])[0]);
    default:
      return null;
  }
}
