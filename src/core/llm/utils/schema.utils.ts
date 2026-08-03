import * as z from "zod";

/**
 * Metadata extracted from a field in a Zod schema
 */
interface FieldMetadata {
  name: string;
  description?: string;
  type: string;
  properties?: Record<string, FieldMetadata>; // For nested objects
  items?: FieldMetadata; // For arrays
}

/**
 * Schema metadata with structured field information
 */
export interface SchemaMetadata {
  fields: Record<string, FieldMetadata>;
  description?: string;
}

/**
 * Converts a Zod schema to JSON Schema format
 *
 * Uses Zod 4's built-in z.toJSONSchema() for native conversion.
 *
 * @param zodSchema - The Zod schema to convert
 * @returns JSON Schema object
 */
export function convertZodToJsonSchema(zodSchema: any): any {
  // JSON round-trip: strips the hidden `~standard` property Zod attaches to its
  // output, which otherwise makes LangChain re-derive the schema instead of
  // forwarding it — see convertZodToDraftJsonSchema below for the full account.
  return JSON.parse(
    JSON.stringify(
      z.toJSONSchema(zodSchema, {
        target: "openapi-3.0", // Use OpenAPI 3.0 format (compatible with OpenAI/Gemini)
        cycles: "ref", // Handle cycles with $defs
        unrepresentable: "any", // Unrepresentable types become {} instead of throwing
      }),
    ),
  );
}

/**
 * Converts a Zod schema to a draft 2020-12 JSON Schema — the dialect OpenAI's
 * structured outputs expect.
 *
 * Distinct from {@link convertZodToJsonSchema}, which targets OpenAPI 3.0 for
 * Gemini. The difference matters for strict mode: OpenAPI 3.0 expresses "may be
 * null" as `nullable: true`, which OpenAI ignores, whereas draft 2020-12 uses a
 * real `{ type: "null" }` branch — the form {@link makeSchemaStrictCompatible}
 * produces.
 *
 * @param zodSchema - The Zod schema to convert
 * @returns JSON Schema in draft 2020-12
 */
export function convertZodToDraftJsonSchema(zodSchema: any): any {
  // The JSON round-trip is NOT cosmetic. Zod's `toJSONSchema` output carries a hidden
  // non-enumerable `~standard` property (the Standard Schema V1 interface). When such
  // an object reaches LangChain's `withStructuredOutput`, its `toJsonSchema` helper
  // detects `~standard` and RE-DERIVES the schema via
  // `schema["~standard"].jsonSchema.input({ target: "draft-07" })` — which demotes
  // defaulted fields out of `required` and drops `additionalProperties: false`, so
  // OpenAI strict mode rejects the request ("'additionalProperties' is required to be
  // supplied and to be false", observed live against Azure gpt-5-nano). Serialising
  // strips every non-JSON property, guaranteeing the schema LangChain forwards is
  // byte-for-byte the schema this function returns.
  return JSON.parse(
    JSON.stringify(
      z.toJSONSchema(zodSchema, {
        target: "draft-2020-12",
        cycles: "ref",
        unrepresentable: "any",
      }),
    ),
  );
}

/**
 * Extracts field metadata from JSON Schema
 *
 * Recursively processes JSON Schema properties to extract:
 * - Field names
 * - Field descriptions
 * - Field types
 * - Nested structures (objects, arrays)
 *
 * @param jsonSchema - JSON Schema object (typically from convertZodToJsonSchema)
 * @returns Structured metadata with field information
 */
function extractFieldMetadataFromJsonSchema(jsonSchema: any): Record<string, FieldMetadata> {
  const fields: Record<string, FieldMetadata> = {};

  if (!jsonSchema.properties) {
    return fields;
  }

  for (const [fieldName, fieldSchema] of Object.entries<any>(jsonSchema.properties)) {
    const metadata: FieldMetadata = {
      name: fieldName,
      description: fieldSchema.description,
      type: fieldSchema.type || "unknown",
    };

    // Handle nested objects
    if (fieldSchema.type === "object" && fieldSchema.properties) {
      metadata.properties = extractFieldMetadataFromJsonSchema(fieldSchema);
    }

    // Handle arrays
    if (fieldSchema.type === "array" && fieldSchema.items) {
      metadata.items = {
        name: "item",
        description: fieldSchema.items.description,
        type: fieldSchema.items.type || "unknown",
      };

      // Handle arrays of objects
      if (fieldSchema.items.type === "object" && fieldSchema.items.properties) {
        metadata.items.properties = extractFieldMetadataFromJsonSchema(fieldSchema.items);
      }
    }

    fields[fieldName] = metadata;
  }

  return fields;
}

/**
 * Extracts structured metadata from a Zod schema
 *
 * This function:
 * 1. Converts Zod schema to JSON Schema
 * 2. Extracts field names, types, and descriptions
 * 3. Returns structured metadata for prompt injection
 *
 * The extracted metadata can be used to:
 * - Generate schema-guided instructions
 * - Create input context prompts
 * - Validate input parameters
 *
 * @param zodSchema - The Zod schema to extract metadata from
 * @returns Structured metadata with field information
 *
 * @example
 * ```typescript
 * const schema = z.object({
 *   name: z.string().describe("The user's name"),
 *   age: z.number().describe("The user's age"),
 * });
 *
 * const metadata = extractSchemaMetadata(schema);
 * // {
 * //   fields: {
 * //     name: { name: "name", description: "The user's name", type: "string" },
 * //     age: { name: "age", description: "The user's age", type: "number" }
 * //   }
 * // }
 * ```
 */
export function extractSchemaMetadata(zodSchema: any): SchemaMetadata {
  const jsonSchema = convertZodToJsonSchema(zodSchema);

  return {
    fields: extractFieldMetadataFromJsonSchema(jsonSchema),
    description: jsonSchema.description,
  };
}

/**
 * Formats a single field value with its description for prompt injection
 *
 * Creates a natural-reading format that combines the field description
 * with its value, making it clear to the LLM what each input represents.
 *
 * @param fieldName - The name of the field
 * @param fieldValue - The value of the field
 * @param description - Optional description from the schema
 * @returns Formatted string for prompt injection
 *
 * @example Without description:
 * ```typescript
 * formatFieldWithDescription("name", "Alice")
 * // Returns: "name: Alice"
 * ```
 *
 * @example With description:
 * ```typescript
 * formatFieldWithDescription(
 *   "recentActions",
 *   ["smiles", "waves"],
 *   "FORBIDDEN actions - NEVER repeat these"
 * )
 * // Returns: "recentActions (FORBIDDEN actions - NEVER repeat these): [...]"
 * ```
 */
export function formatFieldWithDescription(fieldName: string, fieldValue: any, description?: string): string {
  // Format the value based on its type
  let formattedValue: string;
  if (fieldValue === null || fieldValue === undefined) {
    formattedValue = String(fieldValue);
  } else if (typeof fieldValue === "object") {
    // For objects/arrays, use JSON stringify with formatting
    // CRITICAL: Escape curly braces for ChatPromptTemplate
    // Single braces {} are interpreted as template variables
    // Double braces {{}} render as literal {} in the output
    formattedValue = JSON.stringify(fieldValue, null, 2).replace(/{/g, "{{").replace(/}/g, "}}");
  } else {
    // Escape braces in string values too
    formattedValue = String(fieldValue).replace(/{/g, "{{").replace(/}/g, "}}");
  }

  // Include description if available
  if (description) {
    return `${fieldName} (${description}): ${formattedValue}`;
  } else {
    return `${fieldName}: ${formattedValue}`;
  }
}

/**
 * Removes JSON Schema properties not supported by Gemini API.
 *
 * Gemini uses a subset of OpenAPI 3.0 schema that doesn't support:
 * - $schema, $id, $defs, $ref, $comment
 * - allOf, anyOf, oneOf (need flattening)
 *
 * This function recursively sanitizes a JSON Schema to make it Gemini-compatible.
 * Use this when calling Gemini models through proxies like Requesty that don't
 * automatically sanitize schemas.
 *
 * @param schema - JSON Schema object (typically from zodToJsonSchema or convertZodToJsonSchema)
 * @returns Sanitized schema compatible with Gemini API
 *
 * @example
 * ```typescript
 * const jsonSchema = convertZodToJsonSchema(myZodSchema);
 * const geminiSchema = sanitizeSchemaForGemini(jsonSchema);
 * // geminiSchema has no $schema, $defs, etc.
 * ```
 */
export function sanitizeSchemaForGemini(schema: any): any {
  if (!schema || typeof schema !== "object") return schema;

  // Handle arrays
  if (Array.isArray(schema)) {
    return schema.map((item) => sanitizeSchemaForGemini(item));
  }

  const sanitized = { ...schema };

  // Remove unsupported top-level properties
  const unsupportedProps = ["$schema", "$id", "$defs", "$ref", "$comment"];
  for (const prop of unsupportedProps) {
    delete sanitized[prop];
  }

  // Recursively sanitize nested objects in properties
  if (sanitized.properties) {
    sanitized.properties = Object.fromEntries(
      Object.entries(sanitized.properties).map(([key, value]) => [key, sanitizeSchemaForGemini(value)]),
    );
  }

  // Handle array items
  if (sanitized.items) {
    sanitized.items = sanitizeSchemaForGemini(sanitized.items);
  }

  // Handle allOf - merge all schemas into one
  if (Array.isArray(sanitized.allOf)) {
    for (const subSchema of sanitized.allOf) {
      const cleaned = sanitizeSchemaForGemini(subSchema);
      // Merge properties
      if (cleaned.properties) {
        sanitized.properties = { ...sanitized.properties, ...cleaned.properties };
      }
      // Merge required arrays (deduplicate)
      if (cleaned.required) {
        const merged = [...(sanitized.required || []), ...cleaned.required];
        sanitized.required = Array.from(new Set(merged));
      }
      // Copy type if not set
      if (cleaned.type && !sanitized.type) {
        sanitized.type = cleaned.type;
      }
    }
    delete sanitized.allOf;
  }

  // Handle anyOf/oneOf - use first option (simplified approach)
  for (const keyword of ["anyOf", "oneOf"]) {
    if (Array.isArray(sanitized[keyword]) && sanitized[keyword].length > 0) {
      const firstOption = sanitizeSchemaForGemini(sanitized[keyword][0]);
      // Merge the first option into sanitized
      if (firstOption.properties) {
        sanitized.properties = { ...sanitized.properties, ...firstOption.properties };
      }
      if (firstOption.required) {
        const merged = [...(sanitized.required || []), ...firstOption.required];
        sanitized.required = Array.from(new Set(merged));
      }
      if (firstOption.type && !sanitized.type) {
        sanitized.type = firstOption.type;
      }
      delete sanitized[keyword];
    }
  }

  // Recursively sanitize additionalProperties if it's an object schema
  if (sanitized.additionalProperties && typeof sanitized.additionalProperties === "object") {
    sanitized.additionalProperties = sanitizeSchemaForGemini(sanitized.additionalProperties);
  }

  return sanitized;
}

/**
 * Reports whether a schema can be sent through OpenAI's STRICT structured-output
 * mode (`response_format: { type: "json_schema", strict: true }`).
 *
 * Strict mode has two rules that ordinary Zod schemas routinely break:
 *   1. every key in `properties` must also appear in `required` — strict mode
 *      cannot express an absent field, only a null one, so `.optional()` and
 *      `.default()` both violate it;
 *   2. `additionalProperties` must be `false` — so open records cannot qualify.
 *
 * This matters because LangChain hands any Zod schema to `interopZodResponseFormat`,
 * which hardcodes `strict: true`; passing `strict: false` does nothing. A schema
 * that fails these rules must therefore go through tool/function calling instead,
 * which imposes neither rule AND keeps LangChain's Zod validation of the result.
 *
 * Deciding from the schema — rather than from a model or provider name — means no
 * model taxonomy lives in this codebase, and any schema authored strict-clean later
 * automatically earns the stronger guaranteed-conformance path.
 *
 * @param schema - JSON Schema object (typically from {@link convertZodToJsonSchema})
 * @returns true when strict mode would accept the schema
 */
export function isStrictStructuredOutputCompatible(schema: any): boolean {
  if (!schema || typeof schema !== "object") return true;

  if (Array.isArray(schema)) return schema.every((entry) => isStrictStructuredOutputCompatible(entry));

  // A `$ref` cannot be verified from here (nothing in this walk resolves it), and the
  // rewrite in {@link makeSchemaStrictCompatible} does not follow refs either — so a
  // ref-bearing schema must take the tool-calling path, not strict mode. This also
  // matters because OpenAI strict mode rejects a `$ref` carrying ANY sibling keyword
  // ("$ref cannot have keywords {...}", observed live against Azure gpt-5-nano), the
  // exact shape `convertZodToDraftJsonSchema` emits for recursive schemas
  // (`cycles: "ref"`).
  if (typeof schema.$ref === "string") return false;

  if (schema.type === "object") {
    // Checked before `properties`, because an open record (`z.record`) produces an
    // object node with NO `properties` at all — only `additionalProperties` — and
    // strict mode still rejects it.
    if (schema.additionalProperties !== false) return false;

    const required = new Set(Array.isArray(schema.required) ? schema.required : []);
    for (const key of Object.keys(schema.properties ?? {})) {
      if (!required.has(key)) return false;
    }
  }

  for (const key of ["properties", "$defs", "definitions"]) {
    const node = schema[key];
    if (node && typeof node === "object") {
      if (!Object.values(node).every((value) => isStrictStructuredOutputCompatible(value))) return false;
    }
  }

  for (const key of ["items", "additionalProperties", "not"]) {
    if (schema[key] && typeof schema[key] === "object") {
      if (!isStrictStructuredOutputCompatible(schema[key])) return false;
    }
  }

  for (const key of ["anyOf", "oneOf", "allOf"]) {
    if (Array.isArray(schema[key])) {
      if (!schema[key].every((entry: any) => isStrictStructuredOutputCompatible(entry))) return false;
    }
  }

  return true;
}

/**
 * Rewrites a JSON Schema so OpenAI's STRICT structured-output mode accepts it.
 *
 * Strict mode cannot express "this key may be absent" — only "this key may be
 * null". So every property becomes required, and any property that was NOT
 * originally required is widened to `anyOf: [<original>, { type: "null" }]`.
 * `additionalProperties` is closed on every object.
 *
 * This is the request half of a pair: {@link stripSyntheticNulls} undoes it on the
 * response, so the caller's original Zod schema still validates the result.
 *
 * Why bother, rather than routing non-strict schemas to tool calling: strict mode
 * is the only path that GUARANTEES the payload matches the schema. Measured against
 * a live gpt-5-nano deployment, tool calling returned a string where the schema
 * declared `assumptions: string[]` in roughly half of all runs; strict mode cannot
 * do that by construction.
 *
 * @param schema - JSON Schema object (draft 2020-12 shape)
 * @returns A structurally equivalent schema that satisfies strict mode
 */
export function makeSchemaStrictCompatible(schema: any): any {
  if (!schema || typeof schema !== "object") return schema;
  if (Array.isArray(schema)) return schema.map((entry) => makeSchemaStrictCompatible(entry));

  const strict = { ...schema };

  for (const key of ["$defs", "definitions"]) {
    if (strict[key] && typeof strict[key] === "object") {
      strict[key] = Object.fromEntries(
        Object.entries(strict[key]).map(([name, value]) => [name, makeSchemaStrictCompatible(value)]),
      );
    }
  }

  if (strict.items && typeof strict.items === "object") strict.items = makeSchemaStrictCompatible(strict.items);

  for (const key of ["anyOf", "oneOf", "allOf"]) {
    if (Array.isArray(strict[key])) strict[key] = strict[key].map((entry: any) => makeSchemaStrictCompatible(entry));
  }

  if (strict.properties && typeof strict.properties === "object") {
    const wasRequired = new Set(Array.isArray(strict.required) ? strict.required : []);
    strict.properties = Object.fromEntries(
      Object.entries(strict.properties).map(([name, value]) => {
        const child = makeSchemaStrictCompatible(value);
        // Only widen what was optional — a field the author already declared
        // nullable keeps its own shape.
        return [name, wasRequired.has(name) ? child : { anyOf: [child, { type: "null" }] }];
      }),
    );
    strict.required = Object.keys(strict.properties);
    strict.additionalProperties = false;
  }

  return strict;
}

/**
 * Removes the nulls that {@link makeSchemaStrictCompatible} forced the model to emit,
 * so a value produced under strict mode validates against the ORIGINAL schema again.
 *
 * Only keys the transform actually widened are stripped: a key the author declared
 * `.nullable()` was already required, so its null is meaningful and is preserved.
 * Stripping restores absence, which is what `.optional()` expects and what `.default()`
 * needs in order to apply its default.
 *
 * NOT HANDLED — four node kinds this walk never reaches, where an author-intended
 * null could be dropped (or a synthetic one kept). None occur in this repo today, and
 * each would need BOTH this function and {@link isStrictStructuredOutputCompatible}'s
 * traversal extended before it could be trusted:
 *
 *   1. `.nullable().optional()` — the key is absent from `required`, so its null is
 *      read as synthetic and stripped, even though the author declared null to be a
 *      legitimate value. (`.nullable()` alone is safe: it stays required.)
 *   2. Nulls inside `anyOf` / `oneOf` branches — the walk descends only through
 *      `properties` and `items`, so a null-bearing union branch is never visited and
 *      its object properties are compared against no schema at all.
 *   3. Nulls behind `$ref` / `$defs` — there is no ref resolution here, so a
 *      referenced subschema contributes no `required` set and every null under it
 *      survives, synthetic or not.
 *   4. Tuples / `prefixItems` — only the single `items` schema is followed, so a
 *      positional tuple's element schemas are never applied.
 *
 * @param value - The parsed model output
 * @param originalSchema - The schema BEFORE strictification (the source of truth for
 *   which keys were genuinely required)
 */
export function stripSyntheticNulls(value: any, originalSchema: any): any {
  if (!originalSchema || typeof originalSchema !== "object" || value === null || value === undefined) return value;

  if (Array.isArray(value)) {
    const items = originalSchema.items;
    return items ? value.map((entry) => stripSyntheticNulls(entry, items)) : value;
  }

  if (typeof value !== "object") return value;

  const properties = originalSchema.properties;
  if (!properties || typeof properties !== "object") return value;

  const wasRequired = new Set(Array.isArray(originalSchema.required) ? originalSchema.required : []);
  const cleaned: Record<string, any> = {};
  for (const [key, entry] of Object.entries(value)) {
    // Synthetically nullable AND null → the model is saying "absent".
    if (entry === null && !wasRequired.has(key) && key in properties) continue;
    cleaned[key] = key in properties ? stripSyntheticNulls(entry, properties[key]) : entry;
  }
  return cleaned;
}
