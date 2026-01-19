import { vi, describe, it, expect, beforeEach, afterEach } from "vitest";
import "reflect-metadata";
import { validate } from "class-validator";
import { plainToInstance } from "class-transformer";
import {
  StripePriceDTO,
  StripePricePostDTO,
  StripePricePostDataDTO,
  StripePricePostAttributesDTO,
  StripePricePutDTO,
  StripePricePutDataDTO,
  StripePricePutAttributesDTO,
} from "../stripe-price.dto";
import { stripePriceMeta } from "../../entities/stripe-price.meta";

// Mock UUID v4 generator for tests (proper format)
const uuid = () =>
  "xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx".replace(/[xy]/g, (c) => {
    const r = (Math.random() * 16) | 0;
    const v = c === "x" ? r : (r & 0x3) | 0x8;
    return v.toString(16);
  });

describe("StripePriceDTO", () => {
  describe("Base StripePriceDTO", () => {
    it("should validate with correct UUID and type", async () => {
      const dto = plainToInstance(StripePriceDTO, {
        type: stripePriceMeta.endpoint,
        id: uuid(),
      });

      const errors = await validate(dto);
      expect(errors.length).toBe(0);
    });

    it("should fail validation with invalid UUID", async () => {
      const dto = plainToInstance(StripePriceDTO, {
        type: stripePriceMeta.endpoint,
        id: "invalid-uuid",
      });

      const errors = await validate(dto);
      expect(errors.length).toBeGreaterThan(0);
      expect(errors.some((e) => e.property === "id")).toBe(true);
    });

    it("should fail validation with incorrect type", async () => {
      const dto = plainToInstance(StripePriceDTO, {
        type: "wrong-type",
        id: uuid(),
      });

      const errors = await validate(dto);
      expect(errors.length).toBeGreaterThan(0);
      expect(errors.some((e) => e.property === "type")).toBe(true);
    });
  });

  describe("StripePricePostDTO", () => {
    it("should validate complete POST request", async () => {
      const dto = plainToInstance(StripePricePostDTO, {
        data: {
          type: stripePriceMeta.endpoint,
          id: uuid(),
          attributes: {
            productId: uuid(),
            unitAmount: 2999,
            currency: "usd",
            nickname: "Monthly Premium",
            recurring: {
              interval: "month",
              intervalCount: 1,
            },
          },
        },
      });

      const errors = await validate(dto, { whitelist: true, forbidNonWhitelisted: true });
      expect(errors.length).toBe(0);
    });

    it("should validate one-time price (no recurring)", async () => {
      const dto = plainToInstance(StripePricePostDTO, {
        data: {
          type: stripePriceMeta.endpoint,
          id: uuid(),
          attributes: {
            productId: uuid(),
            unitAmount: 999,
            currency: "eur",
          },
        },
      });

      const errors = await validate(dto, { whitelist: true, forbidNonWhitelisted: true });
      expect(errors.length).toBe(0);
    });

    it("should fail without required productId", async () => {
      const dto = plainToInstance(StripePricePostDTO, {
        data: {
          type: stripePriceMeta.endpoint,
          id: uuid(),
          attributes: {
            unitAmount: 2999,
            currency: "usd",
          },
        },
      });

      const errors = await validate(dto, { whitelist: true, forbidNonWhitelisted: true });
      expect(errors.length).toBeGreaterThan(0);
    });

    it("should fail without required currency", async () => {
      const dto = plainToInstance(StripePricePostDTO, {
        data: {
          type: stripePriceMeta.endpoint,
          id: uuid(),
          attributes: {
            productId: uuid(),
            unitAmount: 2999,
          },
        },
      });

      const errors = await validate(dto, { whitelist: true, forbidNonWhitelisted: true });
      expect(errors.length).toBeGreaterThan(0);
    });

    it("should fail with invalid recurring interval", async () => {
      const dto = plainToInstance(StripePricePostDTO, {
        data: {
          type: stripePriceMeta.endpoint,
          id: uuid(),
          attributes: {
            productId: uuid(),
            unitAmount: 2999,
            currency: "usd",
            recurring: {
              interval: "invalid" as any,
            },
          },
        },
      });

      const errors = await validate(dto, { whitelist: true, forbidNonWhitelisted: true });
      expect(errors.length).toBeGreaterThan(0);
    });

    it("should validate with metadata", async () => {
      const dto = plainToInstance(StripePricePostDTO, {
        data: {
          type: stripePriceMeta.endpoint,
          id: uuid(),
          attributes: {
            productId: uuid(),
            unitAmount: 2999,
            currency: "usd",
            metadata: {
              plan: "premium",
              features: "unlimited",
            },
          },
        },
      });

      const errors = await validate(dto, { whitelist: true, forbidNonWhitelisted: true });
      expect(errors.length).toBe(0);
    });

    it("should validate with lookupKey", async () => {
      const dto = plainToInstance(StripePricePostDTO, {
        data: {
          type: stripePriceMeta.endpoint,
          id: uuid(),
          attributes: {
            productId: uuid(),
            unitAmount: 2999,
            currency: "usd",
            lookupKey: "premium-monthly",
          },
        },
      });

      const errors = await validate(dto, { whitelist: true, forbidNonWhitelisted: true });
      expect(errors.length).toBe(0);
    });
  });

  describe("StripePricePutDTO", () => {
    it("should validate PUT request with nickname", async () => {
      const dto = plainToInstance(StripePricePutDTO, {
        data: {
          type: stripePriceMeta.endpoint,
          id: uuid(),
          attributes: {
            nickname: "Updated Premium Plan",
          },
        },
      });

      const errors = await validate(dto, { whitelist: true, forbidNonWhitelisted: true });
      expect(errors.length).toBe(0);
    });

    it("should validate PUT request with metadata", async () => {
      const dto = plainToInstance(StripePricePutDTO, {
        data: {
          type: stripePriceMeta.endpoint,
          id: uuid(),
          attributes: {
            metadata: {
              updated: "true",
              version: "2",
            },
          },
        },
      });

      const errors = await validate(dto, { whitelist: true, forbidNonWhitelisted: true });
      expect(errors.length).toBe(0);
    });

    it("should validate PUT request with empty attributes", async () => {
      const dto = plainToInstance(StripePricePutDTO, {
        data: {
          type: stripePriceMeta.endpoint,
          id: uuid(),
          attributes: {},
        },
      });

      const errors = await validate(dto, { whitelist: true, forbidNonWhitelisted: true });
      expect(errors.length).toBe(0);
    });

    it("should fail with invalid UUID in PUT", async () => {
      const dto = plainToInstance(StripePricePutDTO, {
        data: {
          type: stripePriceMeta.endpoint,
          id: "not-a-uuid",
          attributes: {
            nickname: "Updated",
          },
        },
      });

      const errors = await validate(dto, { whitelist: true, forbidNonWhitelisted: true });
      expect(errors.length).toBeGreaterThan(0);
      expect(errors.some((e) => e.property === "data")).toBe(true);
    });

    it("should fail with incorrect type in PUT", async () => {
      const dto = plainToInstance(StripePricePutDTO, {
        data: {
          type: "wrong-type",
          id: uuid(),
          attributes: {
            nickname: "Updated",
          },
        },
      });

      const errors = await validate(dto, { whitelist: true, forbidNonWhitelisted: true });
      expect(errors.length).toBeGreaterThan(0);
    });
  });

  describe("Nested DTO Validation", () => {
    it("should validate nested PostAttributesDTO", async () => {
      const dto = plainToInstance(StripePricePostAttributesDTO, {
        productId: uuid(),
        unitAmount: 1999,
        currency: "gbp",
        nickname: "Basic Plan",
        recurring: {
          interval: "year",
          intervalCount: 1,
        },
      });

      const errors = await validate(dto);
      expect(errors.length).toBe(0);
    });

    it("should validate nested PutAttributesDTO", async () => {
      const dto = plainToInstance(StripePricePutAttributesDTO, {
        nickname: "Updated Plan",
        metadata: { key: "value" },
      });

      const errors = await validate(dto);
      expect(errors.length).toBe(0);
    });

    it("should fail with nickname exceeding max length", async () => {
      const longNickname = "a".repeat(300);
      const dto = plainToInstance(StripePricePutAttributesDTO, {
        nickname: longNickname,
      });

      const errors = await validate(dto);
      expect(errors.length).toBeGreaterThan(0);
      expect(errors.some((e) => e.property === "nickname")).toBe(true);
    });

    it("should fail with currency exceeding max length", async () => {
      const dto = plainToInstance(StripePricePostAttributesDTO, {
        productId: uuid(),
        unitAmount: 1999,
        currency: "toolong",
      });

      const errors = await validate(dto);
      expect(errors.length).toBeGreaterThan(0);
      expect(errors.some((e) => e.property === "currency")).toBe(true);
    });
  });
});
