import "reflect-metadata";
import { validate } from "class-validator";
import { plainToInstance } from "class-transformer";
import {
  StripeCustomerPostDTO,
  StripeCustomerPostDataDTO,
  StripeCustomerPostAttributesDTO,
  StripeCustomerPutDTO,
  StripeCustomerPutDataDTO,
  StripeCustomerPutAttributesDTO,
} from "../stripe-customer.dto";
import { stripeCustomerMeta } from "../../entities/stripe-customer.meta";

describe("StripeCustomerPostDTO", () => {
  const validId = "550e8400-e29b-41d4-a716-446655440000";

  describe("valid payloads", () => {
    it("should pass validation with all required fields", async () => {
      const payload = {
        data: {
          type: stripeCustomerMeta.endpoint,
          id: validId,
          attributes: {
            name: "Test Company",
            email: "test@example.com",
            currency: "usd",
          },
        },
      };

      const dto = plainToInstance(StripeCustomerPostDTO, payload);
      const errors = await validate(dto);

      expect(errors.length).toBe(0);
    });

    it("should accept valid email formats", async () => {
      const emails = ["user@domain.com", "user.name@domain.co.uk", "user+tag@domain.org"];

      for (const email of emails) {
        const payload = {
          data: {
            type: stripeCustomerMeta.endpoint,
            id: validId,
            attributes: {
              name: "Test",
              email,
              currency: "usd",
            },
          },
        };

        const dto = plainToInstance(StripeCustomerPostDTO, payload);
        const errors = await validate(dto);

        expect(errors.length).toBe(0);
      }
    });
  });

  describe("optional fields", () => {
    it("should pass validation when data is missing (auto-fetch from company)", async () => {
      const payload = {};

      const dto = plainToInstance(StripeCustomerPostDTO, payload);
      const errors = await validate(dto);

      expect(errors.length).toBe(0);
    });
  });

  describe("invalid payloads", () => {
    it("should fail validation when type is wrong", async () => {
      const payload = {
        data: {
          type: "wrong-type",
          id: validId,
          attributes: {
            name: "Test",
            email: "test@example.com",
            currency: "usd",
          },
        },
      };

      const dto = plainToInstance(StripeCustomerPostDTO, payload);
      const errors = await validate(dto);

      expect(errors.length).toBeGreaterThan(0);
    });

    it("should fail validation when id is not a UUID", async () => {
      const payload = {
        data: {
          type: stripeCustomerMeta.endpoint,
          id: "not-a-uuid",
          attributes: {
            name: "Test",
            email: "test@example.com",
            currency: "usd",
          },
        },
      };

      const dto = plainToInstance(StripeCustomerPostDTO, payload);
      const errors = await validate(dto);

      expect(errors.length).toBeGreaterThan(0);
    });

    it("should fail validation when email is invalid", async () => {
      const payload = {
        data: {
          type: stripeCustomerMeta.endpoint,
          id: validId,
          attributes: {
            name: "Test",
            email: "not-an-email",
            currency: "usd",
          },
        },
      };

      const dto = plainToInstance(StripeCustomerPostDTO, payload);
      const errors = await validate(dto);

      expect(errors.length).toBeGreaterThan(0);
    });

    it("should fail validation when currency is too long", async () => {
      const payload = {
        data: {
          type: stripeCustomerMeta.endpoint,
          id: validId,
          attributes: {
            name: "Test",
            email: "test@example.com",
            currency: "toolong",
          },
        },
      };

      const dto = plainToInstance(StripeCustomerPostDTO, payload);
      const errors = await validate(dto);

      expect(errors.length).toBeGreaterThan(0);
    });
  });
});

describe("StripeCustomerPutDTO", () => {
  const validId = "550e8400-e29b-41d4-a716-446655440000";

  describe("valid payloads", () => {
    it("should pass validation with all optional fields", async () => {
      const payload = {
        data: {
          type: stripeCustomerMeta.endpoint,
          id: validId,
          attributes: {
            name: "Updated Name",
            email: "updated@example.com",
            defaultPaymentMethodId: "pm_test123",
          },
        },
      };

      const dto = plainToInstance(StripeCustomerPutDTO, payload);
      const errors = await validate(dto);

      expect(errors.length).toBe(0);
    });

    it("should pass validation with only name", async () => {
      const payload = {
        data: {
          type: stripeCustomerMeta.endpoint,
          id: validId,
          attributes: {
            name: "New Name",
          },
        },
      };

      const dto = plainToInstance(StripeCustomerPutDTO, payload);
      const errors = await validate(dto);

      expect(errors.length).toBe(0);
    });

    it("should pass validation with only email", async () => {
      const payload = {
        data: {
          type: stripeCustomerMeta.endpoint,
          id: validId,
          attributes: {
            email: "new@example.com",
          },
        },
      };

      const dto = plainToInstance(StripeCustomerPutDTO, payload);
      const errors = await validate(dto);

      expect(errors.length).toBe(0);
    });

    it("should pass validation with only defaultPaymentMethodId", async () => {
      const payload = {
        data: {
          type: stripeCustomerMeta.endpoint,
          id: validId,
          attributes: {
            defaultPaymentMethodId: "pm_test123",
          },
        },
      };

      const dto = plainToInstance(StripeCustomerPutDTO, payload);
      const errors = await validate(dto);

      expect(errors.length).toBe(0);
    });

    it("should pass validation with no attributes", async () => {
      const payload = {
        data: {
          type: stripeCustomerMeta.endpoint,
          id: validId,
        },
      };

      const dto = plainToInstance(StripeCustomerPutDTO, payload);
      const errors = await validate(dto);

      expect(errors.length).toBe(0);
    });
  });

  describe("invalid payloads", () => {
    it("should fail validation when type is wrong", async () => {
      const payload = {
        data: {
          type: "wrong-type",
          id: validId,
          attributes: {
            name: "Test",
          },
        },
      };

      const dto = plainToInstance(StripeCustomerPutDTO, payload);
      const errors = await validate(dto);

      expect(errors.length).toBeGreaterThan(0);
    });

    it("should fail validation when id is not a UUID", async () => {
      const payload = {
        data: {
          type: stripeCustomerMeta.endpoint,
          id: "not-a-uuid",
          attributes: {
            name: "Test",
          },
        },
      };

      const dto = plainToInstance(StripeCustomerPutDTO, payload);
      const errors = await validate(dto);

      expect(errors.length).toBeGreaterThan(0);
    });

    it("should fail validation when email is invalid", async () => {
      const payload = {
        data: {
          type: stripeCustomerMeta.endpoint,
          id: validId,
          attributes: {
            email: "not-an-email",
          },
        },
      };

      const dto = plainToInstance(StripeCustomerPutDTO, payload);
      const errors = await validate(dto);

      expect(errors.length).toBeGreaterThan(0);
    });
  });
});
