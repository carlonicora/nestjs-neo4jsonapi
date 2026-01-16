/**
 * Company Mapper Unit Tests
 *
 * Tests the mapCompany function that converts Neo4j records to Company entities.
 * These tests verify that entity mapping works correctly before and after migration.
 */

import { describe, it, expect, vi } from "vitest";
import { mapCompany } from "./company.map";
import { EntityFactory } from "../../../core/neo4j/factories/entity.factory";

describe("mapCompany", () => {
  const mockEntityFactory = {} as EntityFactory;

  describe("basic field mapping", () => {
    it("should map all required fields from data", () => {
      const mockData = {
        id: "company-123",
        name: "Test Company",
        configurations: '{"setting": true}',
        logo: "logos/test.png",
        logoUrl: "https://s3.amazonaws.com/logos/test.png",
        monthlyTokens: 10000,
        availableMonthlyTokens: 5000,
        availableExtraTokens: 2000,
        ownerEmail: "owner@test.com",
        isActiveSubscription: true,
        createdAt: "2024-01-01T00:00:00.000Z",
        updatedAt: "2024-06-15T12:30:00.000Z",
      };

      const result = mapCompany({
        data: mockData,
        record: {},
        entityFactory: mockEntityFactory,
      });

      expect(result.id).toBe("company-123");
      expect(result.name).toBe("Test Company");
      expect(result.configurations).toBe('{"setting": true}');
      expect(result.logo).toBe("logos/test.png");
      expect(result.logoUrl).toBe("https://s3.amazonaws.com/logos/test.png");
      expect(result.monthlyTokens).toBe(10000);
      expect(result.availableMonthlyTokens).toBe(5000);
      expect(result.availableExtraTokens).toBe(2000);
      expect(result.ownerEmail).toBe("owner@test.com");
      expect(result.isActiveSubscription).toBe(true);
    });

    it("should default numeric fields to 0 when undefined", () => {
      const mockData = {
        id: "company-456",
        name: "Minimal Company",
        ownerEmail: "owner@minimal.com",
        isActiveSubscription: false,
        createdAt: "2024-01-01T00:00:00.000Z",
        updatedAt: "2024-01-01T00:00:00.000Z",
      };

      const result = mapCompany({
        data: mockData,
        record: {},
        entityFactory: mockEntityFactory,
      });

      expect(result.monthlyTokens).toBe(0);
      expect(result.availableMonthlyTokens).toBe(0);
      expect(result.availableExtraTokens).toBe(0);
    });

    it("should initialize relationships as empty arrays", () => {
      const mockData = {
        id: "company-789",
        name: "Test Company",
        ownerEmail: "test@test.com",
        isActiveSubscription: true,
        createdAt: "2024-01-01T00:00:00.000Z",
        updatedAt: "2024-01-01T00:00:00.000Z",
      };

      const result = mapCompany({
        data: mockData,
        record: {},
        entityFactory: mockEntityFactory,
      });

      expect(result.feature).toEqual([]);
      expect(result.module).toEqual([]);
      expect(result.configuration).toBeUndefined();
    });
  });

  describe("optional field handling", () => {
    it("should handle undefined optional string fields", () => {
      const mockData = {
        id: "company-opt-1",
        name: "Optional Test",
        ownerEmail: "opt@test.com",
        isActiveSubscription: false,
        createdAt: "2024-01-01T00:00:00.000Z",
        updatedAt: "2024-01-01T00:00:00.000Z",
        // configurations, logo, logoUrl are undefined
      };

      const result = mapCompany({
        data: mockData,
        record: {},
        entityFactory: mockEntityFactory,
      });

      expect(result.configurations).toBeUndefined();
      expect(result.logo).toBeUndefined();
      expect(result.logoUrl).toBeUndefined();
    });

    it("should handle null values in data", () => {
      const mockData = {
        id: "company-null-1",
        name: "Null Test",
        configurations: null,
        logo: null,
        logoUrl: null,
        monthlyTokens: null,
        ownerEmail: "null@test.com",
        isActiveSubscription: false,
        createdAt: "2024-01-01T00:00:00.000Z",
        updatedAt: "2024-01-01T00:00:00.000Z",
      };

      const result = mapCompany({
        data: mockData,
        record: {},
        entityFactory: mockEntityFactory,
      });

      expect(result.configurations).toBeNull();
      expect(result.logo).toBeNull();
      expect(result.monthlyTokens).toBe(0); // Falls back to default
    });
  });

  describe("Neo4j data type handling", () => {
    it("should handle Neo4j integer values (BigInt)", () => {
      const mockData = {
        id: "company-bigint-1",
        name: "BigInt Test",
        monthlyTokens: BigInt(50000),
        availableMonthlyTokens: BigInt(25000),
        availableExtraTokens: BigInt(10000),
        ownerEmail: "bigint@test.com",
        isActiveSubscription: true,
        createdAt: "2024-01-01T00:00:00.000Z",
        updatedAt: "2024-01-01T00:00:00.000Z",
      };

      const result = mapCompany({
        data: mockData,
        record: {},
        entityFactory: mockEntityFactory,
      });

      // BigInt values should be passed through (handled by serializer for conversion)
      expect(result.monthlyTokens).toBe(BigInt(50000));
      expect(result.availableMonthlyTokens).toBe(BigInt(25000));
      expect(result.availableExtraTokens).toBe(BigInt(10000));
    });

    it("should handle zero token values", () => {
      const mockData = {
        id: "company-zero-1",
        name: "Zero Tokens",
        monthlyTokens: 0,
        availableMonthlyTokens: 0,
        availableExtraTokens: 0,
        ownerEmail: "zero@test.com",
        isActiveSubscription: false,
        createdAt: "2024-01-01T00:00:00.000Z",
        updatedAt: "2024-01-01T00:00:00.000Z",
      };

      const result = mapCompany({
        data: mockData,
        record: {},
        entityFactory: mockEntityFactory,
      });

      expect(result.monthlyTokens).toBe(0);
      expect(result.availableMonthlyTokens).toBe(0);
      expect(result.availableExtraTokens).toBe(0);
    });
  });

  describe("base entity fields", () => {
    it("should include base entity fields from mapEntity", () => {
      const mockData = {
        id: "company-base-1",
        name: "Base Entity Test",
        ownerEmail: "base@test.com",
        isActiveSubscription: true,
        type: "companies",
        createdAt: "2024-01-15T10:30:00.000Z",
        updatedAt: "2024-06-20T14:45:00.000Z",
      };

      const result = mapCompany({
        data: mockData,
        record: {},
        entityFactory: mockEntityFactory,
      });

      expect(result.id).toBe("company-base-1");
      expect(result.createdAt).toBeInstanceOf(Date);
      expect(result.updatedAt).toBeInstanceOf(Date);
    });

    it("should handle records with Neo4j labels", () => {
      const mockData = {
        id: "company-labels-1",
        name: "Labels Test",
        ownerEmail: "labels@test.com",
        isActiveSubscription: true,
        labels: ["Company", "Organization"],
        createdAt: "2024-01-01T00:00:00.000Z",
        updatedAt: "2024-01-01T00:00:00.000Z",
      };

      const result = mapCompany({
        data: mockData,
        record: {},
        entityFactory: mockEntityFactory,
      });

      expect(result.id).toBe("company-labels-1");
      expect(result.labels).toEqual(["Company", "Organization"]);
    });
  });

  describe("edge cases", () => {
    it("should handle empty string values", () => {
      const mockData = {
        id: "company-empty-1",
        name: "",
        configurations: "",
        logo: "",
        logoUrl: "",
        ownerEmail: "",
        isActiveSubscription: false,
        createdAt: "2024-01-01T00:00:00.000Z",
        updatedAt: "2024-01-01T00:00:00.000Z",
      };

      const result = mapCompany({
        data: mockData,
        record: {},
        entityFactory: mockEntityFactory,
      });

      expect(result.name).toBe("");
      expect(result.configurations).toBe("");
      expect(result.logo).toBe("");
      expect(result.logoUrl).toBe("");
    });

    it("should handle very large token values", () => {
      const mockData = {
        id: "company-large-1",
        name: "Large Tokens",
        monthlyTokens: 999999999999,
        availableMonthlyTokens: 888888888888,
        availableExtraTokens: 777777777777,
        ownerEmail: "large@test.com",
        isActiveSubscription: true,
        createdAt: "2024-01-01T00:00:00.000Z",
        updatedAt: "2024-01-01T00:00:00.000Z",
      };

      const result = mapCompany({
        data: mockData,
        record: {},
        entityFactory: mockEntityFactory,
      });

      expect(result.monthlyTokens).toBe(999999999999);
      expect(result.availableMonthlyTokens).toBe(888888888888);
      expect(result.availableExtraTokens).toBe(777777777777);
    });

    it("should handle special characters in string fields", () => {
      const mockData = {
        id: "company-special-1",
        name: "Test & Co. <Script>",
        configurations: '{"key": "value with \\\"quotes\\\""}',
        ownerEmail: "test+special@test.com",
        isActiveSubscription: true,
        createdAt: "2024-01-01T00:00:00.000Z",
        updatedAt: "2024-01-01T00:00:00.000Z",
      };

      const result = mapCompany({
        data: mockData,
        record: {},
        entityFactory: mockEntityFactory,
      });

      expect(result.name).toBe("Test & Co. <Script>");
      expect(result.configurations).toBe('{"key": "value with \\"quotes\\""}');
      expect(result.ownerEmail).toBe("test+special@test.com");
    });
  });
});
