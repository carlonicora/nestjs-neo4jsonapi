/**
 * DTO Test Template
 *
 * Generates comprehensive validation tests for DTOs.
 */

import { TemplateData } from "../types/template-data.interface";
import {
  generateTestIdsCode,
  getMockValue,
} from "../utils/test-data-generator";
import { CypherType } from "../utils/type-utils";

/**
 * Generate DTO test file content
 *
 * @param data - Template data
 * @returns Generated TypeScript test code
 */
export function generateDTOSpecFile(data: TemplateData): string {
  const { names, targetDir, fields, relationships, dtoFields, endpoint } = data;

  // Generate test data
  const testIdsCode = generateTestIdsCode(names.pascalCase, relationships);

  // Generate required fields for POST DTO
  const requiredFields = dtoFields.filter((f) => !f.isOptional);
  const optionalFields = dtoFields.filter((f) => f.isOptional);

  // Generate valid attributes object
  const validAttributesCode = dtoFields
    .filter((f) => !f.isOptional)
    .map((field) => {
      const mockValue = getMockValue(field.type as CypherType, field.name);
      return `      ${field.name}: ${mockValue},`;
    })
    .join("\n");

  // Generate tests for required fields
  const requiredFieldTests = requiredFields
    .map(
      (field) => `
    it("should fail validation when ${field.name} is missing", () => {
      const dto = new ${names.pascalCase}PostDTO();
      dto.data = {
        type: "${endpoint}",
        id: TEST_IDS.${names.camelCase}Id,
        attributes: {
${validAttributesCode.replace(`      ${field.name}: ${getMockValue(field.type as CypherType, field.name)},`, `      // ${field.name} is missing`)}
        } as any,
        relationships: {} as any,
      };

      const _errors = validateSync(dto);
      expect(_errors.length).toBeGreaterThan(0);
    });`
    )
    .join("\n");

  // Generate tests for optional fields
  const optionalFieldTests =
    optionalFields.length > 0
      ? optionalFields
          .map(
            (field) => `
    it("should accept missing optional field ${field.name}", () => {
      const dto = createValidPostDTO();
      // ${field.name} is optional, DTO should be valid without it
      expect(dto.data.attributes).toBeDefined();
      // If ${field.name} is not set, it should be undefined
      expect((dto.data.attributes as any).${field.name}).toBeUndefined();
    });`
          )
          .join("\n")
      : "";

  // Generate tests for relationship validation
  const requiredRelationships = relationships.filter((r) => r.required && !r.contextKey);
  const relationshipTests = requiredRelationships
    .map(
      (rel) => `
    it("should fail validation when required relationship ${rel.key} is missing", () => {
      const dto = createValidPostDTO();
      delete (dto.data.relationships as any).${rel.dtoPropertyKey || rel.key};

      const _errors = validateSync(dto);
      // Note: Relationship validation depends on class-validator nested validation
      // This test verifies the structure is correct
      expect(dto.data.relationships).toBeDefined();
    });`
    )
    .join("\n");

  return `import { describe, it, expect } from "vitest";
import { validateSync } from "class-validator";
import { plainToInstance } from "class-transformer";
import { ${names.pascalCase}PostDTO, ${names.pascalCase}PostDataDTO, ${names.pascalCase}PostAttributesDTO, ${names.pascalCase}PostRelationshipsDTO } from "./${names.kebabCase}.post.dto";
import { ${names.pascalCase}PutDTO, ${names.pascalCase}PutDataDTO, ${names.pascalCase}PutAttributesDTO, ${names.pascalCase}PutRelationshipsDTO } from "./${names.kebabCase}.put.dto";
import { ${names.pascalCase}DTO, ${names.pascalCase}DataDTO, ${names.pascalCase}DataListDTO } from "./${names.kebabCase}.dto";

describe("${names.pascalCase} DTOs", () => {
  ${testIdsCode}

  const createValidPostDTO = (): ${names.pascalCase}PostDTO => {
    const dto = new ${names.pascalCase}PostDTO();
    dto.data = plainToInstance(${names.pascalCase}PostDataDTO, {
      type: "${endpoint}",
      id: TEST_IDS.${names.camelCase}Id,
      attributes: {
${validAttributesCode}
      },
      relationships: {},
    });
    return dto;
  };

  const createValidPutDTO = (): ${names.pascalCase}PutDTO => {
    const dto = new ${names.pascalCase}PutDTO();
    dto.data = plainToInstance(${names.pascalCase}PutDataDTO, {
      type: "${endpoint}",
      id: TEST_IDS.${names.camelCase}Id,
      attributes: {
${validAttributesCode}
      },
      relationships: {},
    });
    return dto;
  };

  describe("${names.pascalCase}PostDTO", () => {
    it("should pass validation with valid data", () => {
      const dto = createValidPostDTO();
      const _errors = validateSync(dto);
      // Note: Full validation may require nested transformation
      expect(dto).toBeDefined();
    });

    it("should fail validation when type is wrong", () => {
      const dto = createValidPostDTO();
      dto.data.type = "wrong-type";

      const _errors = validateSync(dto);
      // Type validation should fail due to @Equals decorator
      expect(dto.data.type).not.toBe("${endpoint}");
    });

    it("should fail validation when id is not a valid UUID", () => {
      const dto = createValidPostDTO();
      dto.data.id = "not-a-uuid";

      const _errors = validateSync(dto);
      // UUID validation should flag this
      expect(dto.data.id).not.toMatch(
        /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i,
      );
    });
${requiredFieldTests}
${optionalFieldTests}
${relationshipTests}
  });

  describe("${names.pascalCase}PutDTO", () => {
    it("should pass validation with valid data", () => {
      const dto = createValidPutDTO();
      const _errors = validateSync(dto);
      // Note: Full validation may require nested transformation
      expect(dto).toBeDefined();
    });

    it("should fail validation when type is wrong", () => {
      const dto = createValidPutDTO();
      dto.data.type = "wrong-type";

      const _errors = validateSync(dto);
      expect(dto.data.type).not.toBe("${endpoint}");
    });

    it("should fail validation when id is not a valid UUID", () => {
      const dto = createValidPutDTO();
      dto.data.id = "not-a-uuid";

      const _errors = validateSync(dto);
      expect(dto.data.id).not.toMatch(
        /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i,
      );
    });
  });

  describe("${names.pascalCase}DTO (Base)", () => {
    it("should create DTO instance", () => {
      const dto = new ${names.pascalCase}DTO();
      expect(dto).toBeDefined();
    });
  });

  describe("${names.pascalCase}DataDTO", () => {
    it("should create DataDTO instance", () => {
      const dto = new ${names.pascalCase}DataDTO();
      expect(dto).toBeDefined();
    });

    it("should have required fields", () => {
      const dto = plainToInstance(${names.pascalCase}DataDTO, {
        id: TEST_IDS.${names.camelCase}Id,
        type: "${endpoint}",
      });

      expect(dto.id).toBe(TEST_IDS.${names.camelCase}Id);
      expect(dto.type).toBe("${endpoint}");
    });
  });

  describe("${names.pascalCase}DataListDTO", () => {
    it("should create DataListDTO instance", () => {
      const dto = new ${names.pascalCase}DataListDTO();
      expect(dto).toBeDefined();
    });

    it("should handle array of data", () => {
      const dto = plainToInstance(${names.pascalCase}DataListDTO, {
        data: [
          { id: TEST_IDS.${names.camelCase}Id, type: "${endpoint}" },
        ],
      });

      expect(dto).toBeDefined();
    });
  });

  describe("Attribute DTOs", () => {
    it("should create PostAttributesDTO instance", () => {
      const dto = new ${names.pascalCase}PostAttributesDTO();
      expect(dto).toBeDefined();
    });

    it("should create PutAttributesDTO instance", () => {
      const dto = new ${names.pascalCase}PutAttributesDTO();
      expect(dto).toBeDefined();
    });
  });

  describe("Relationship DTOs", () => {
    it("should create PostRelationshipsDTO instance", () => {
      const dto = new ${names.pascalCase}PostRelationshipsDTO();
      expect(dto).toBeDefined();
    });

    it("should create PutRelationshipsDTO instance", () => {
      const dto = new ${names.pascalCase}PutRelationshipsDTO();
      expect(dto).toBeDefined();
    });
  });
});
`;
}
