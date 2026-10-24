import "reflect-metadata";
import { BadRequestException, ValidationPipe } from "@nestjs/common";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { StripeCouponCodeAutomaticQueryDTO } from "../../dtos/stripe-coupon-code.automatic.query.dto";
import { StripeCouponCodeCheckoutController } from "../stripe-coupon-code-checkout.controller";

const PRICE_ID = "6f1c1f3e-8a5b-4c3d-9e2f-1a2b3c4d5e6f";

// The same options bootstrap() gives the global pipe
const pipe = new ValidationPipe({ whitelist: true, transform: true, validateCustomDecorators: true });
const validateQuery = (query: Record<string, unknown>) =>
  pipe.transform(query, { type: "query", metatype: StripeCouponCodeAutomaticQueryDTO });

describe("GET stripe-coupon-codes/automatic query", () => {
  it("refuses a request without priceId", async () => {
    await expect(validateQuery({})).rejects.toBeInstanceOf(BadRequestException);
  });

  it("refuses a priceId that is not a UUID", async () => {
    await expect(validateQuery({ priceId: "price_1" })).rejects.toBeInstanceOf(BadRequestException);
  });

  it("accepts a UUID priceId", async () => {
    await expect(validateQuery({ priceId: PRICE_ID })).resolves.toEqual({ priceId: PRICE_ID });
  });
});

describe("StripeCouponCodeCheckoutController.findAutomatic", () => {
  let service: { findAutomaticForPriceDocument: ReturnType<typeof vi.fn> };
  let controller: StripeCouponCodeCheckoutController;

  beforeEach(() => {
    service = { findAutomaticForPriceDocument: vi.fn().mockResolvedValue({ data: [] }) };
    controller = new StripeCouponCodeCheckoutController(service as any);
  });

  it("passes the company, the validated priceId and the raw query to the service", async () => {
    const reply = { send: vi.fn() } as any;
    const query = { priceId: PRICE_ID, "page[size]": "1" };

    await controller.findAutomatic({ user: { companyId: "company_1" } } as any, reply, query, {
      priceId: PRICE_ID,
    });

    expect(service.findAutomaticForPriceDocument).toHaveBeenCalledWith({
      companyId: "company_1",
      priceId: PRICE_ID,
      query,
    });
    expect(reply.send).toHaveBeenCalledWith({ data: [] });
  });
});
