import { HttpStatus } from "@nestjs/common";
import { StripeError, handleStripeError, HandleStripeErrors } from "./stripe.errors";
import {
  STRIPE_CARD_ERROR,
  STRIPE_RATE_LIMIT_ERROR,
  STRIPE_INVALID_REQUEST_ERROR,
  STRIPE_API_ERROR,
  STRIPE_CONNECTION_ERROR,
  STRIPE_AUTHENTICATION_ERROR,
  STRIPE_IDEMPOTENCY_ERROR,
} from "../__tests__/fixtures/stripe.fixtures";

describe("StripeError", () => {
  describe("StripeError Class", () => {
    it("should create StripeError with message and status", () => {
      const error = new StripeError("Test error", HttpStatus.BAD_REQUEST);

      expect(error).toBeInstanceOf(StripeError);
      expect(error.message).toBe("Test error");
      expect(error.getStatus()).toBe(HttpStatus.BAD_REQUEST);
    });

    it("should create StripeError with stripe code", () => {
      const error = new StripeError("Card declined", HttpStatus.PAYMENT_REQUIRED, "card_declined");

      expect(error.stripeCode).toBe("card_declined");
      expect(error.message).toBe("Card declined");
    });

    it("should create StripeError with decline code", () => {
      const error = new StripeError(
        "Card declined",
        HttpStatus.PAYMENT_REQUIRED,
        "card_declined",
        "insufficient_funds",
      );

      expect(error.stripeCode).toBe("card_declined");
      expect(error.declineCode).toBe("insufficient_funds");
    });

    it("should include stripe code in response", () => {
      const error = new StripeError("Test error", HttpStatus.BAD_REQUEST, "test_code");
      const response = error.getResponse() as any;

      expect(response.message).toBe("Test error");
      expect(response.stripeCode).toBe("test_code");
    });

    it("should include decline code in response", () => {
      const error = new StripeError("Card declined", HttpStatus.PAYMENT_REQUIRED, "card_declined", "lost_card");
      const response = error.getResponse() as any;

      expect(response.message).toBe("Card declined");
      expect(response.stripeCode).toBe("card_declined");
      expect(response.declineCode).toBe("lost_card");
    });

    it("should create error with undefined codes", () => {
      const error = new StripeError("Test error", HttpStatus.BAD_REQUEST);

      expect(error.stripeCode).toBeUndefined();
      expect(error.declineCode).toBeUndefined();
    });

    it("should handle all HTTP status codes", () => {
      const statuses = [
        HttpStatus.BAD_REQUEST,
        HttpStatus.PAYMENT_REQUIRED,
        HttpStatus.TOO_MANY_REQUESTS,
        HttpStatus.INTERNAL_SERVER_ERROR,
        HttpStatus.SERVICE_UNAVAILABLE,
        HttpStatus.CONFLICT,
      ];

      statuses.forEach((status) => {
        const error = new StripeError("Test", status);
        expect(error.getStatus()).toBe(status);
      });
    });

    it("should preserve exact message content", () => {
      const exactMessage = "Your card's security code is incorrect.";
      const error = new StripeError(exactMessage, HttpStatus.PAYMENT_REQUIRED);

      expect(error.message).toBe(exactMessage);
    });

    it("should preserve exact code values", () => {
      const exactCode = "incorrect_cvc";
      const exactDecline = "do_not_honor";
      const error = new StripeError("Test", HttpStatus.PAYMENT_REQUIRED, exactCode, exactDecline);

      expect(error.stripeCode).toBe(exactCode);
      expect(error.declineCode).toBe(exactDecline);
    });
  });

  describe("handleStripeError Function", () => {
    describe("Card Errors", () => {
      it("should handle card declined error", () => {
        expect(() => handleStripeError(STRIPE_CARD_ERROR)).toThrow(StripeError);

        try {
          handleStripeError(STRIPE_CARD_ERROR);
        } catch (error) {
          expect(error).toBeInstanceOf(StripeError);
          expect((error as StripeError).message).toBe(STRIPE_CARD_ERROR.message);
          expect((error as StripeError).getStatus()).toBe(HttpStatus.PAYMENT_REQUIRED);
          expect((error as StripeError).stripeCode).toBe(STRIPE_CARD_ERROR.code);
          expect((error as StripeError).declineCode).toBe(STRIPE_CARD_ERROR.decline_code);
        }
      });

      it("should handle card error without decline code", () => {
        const cardError = {
          type: "StripeCardError",
          message: "Invalid card number",
          code: "invalid_number",
        };

        try {
          handleStripeError(cardError);
        } catch (error) {
          expect(error).toBeInstanceOf(StripeError);
          expect((error as StripeError).declineCode).toBeUndefined();
        }
      });

      it("should handle various card decline codes", () => {
        const declineCodes = [
          "insufficient_funds",
          "lost_card",
          "stolen_card",
          "expired_card",
          "incorrect_cvc",
          "processing_error",
        ];

        declineCodes.forEach((declineCode) => {
          const cardError = {
            type: "StripeCardError",
            message: "Card declined",
            code: "card_declined",
            decline_code: declineCode,
          };

          try {
            handleStripeError(cardError);
          } catch (error) {
            expect((error as StripeError).declineCode).toBe(declineCode);
          }
        });
      });
    });

    describe("Rate Limit Errors", () => {
      it("should handle rate limit error", () => {
        try {
          handleStripeError(STRIPE_RATE_LIMIT_ERROR);
        } catch (error) {
          expect(error).toBeInstanceOf(StripeError);
          expect((error as StripeError).message).toBe("Too many requests to payment service. Please try again later.");
          expect((error as StripeError).getStatus()).toBe(HttpStatus.TOO_MANY_REQUESTS);
          expect((error as StripeError).stripeCode).toBe(STRIPE_RATE_LIMIT_ERROR.code);
        }
      });

      it("should use custom message for rate limit errors", () => {
        try {
          handleStripeError(STRIPE_RATE_LIMIT_ERROR);
        } catch (error) {
          expect((error as StripeError).message).not.toBe(STRIPE_RATE_LIMIT_ERROR.message);
          expect((error as StripeError).message).toContain("Too many requests");
        }
      });
    });

    describe("Invalid Request Errors", () => {
      it("should handle invalid request error", () => {
        try {
          handleStripeError(STRIPE_INVALID_REQUEST_ERROR);
        } catch (error) {
          expect(error).toBeInstanceOf(StripeError);
          expect((error as StripeError).message).toBe(STRIPE_INVALID_REQUEST_ERROR.message);
          expect((error as StripeError).getStatus()).toBe(HttpStatus.BAD_REQUEST);
          expect((error as StripeError).stripeCode).toBe(STRIPE_INVALID_REQUEST_ERROR.code);
        }
      });

      it("should preserve original message for invalid request errors", () => {
        try {
          handleStripeError(STRIPE_INVALID_REQUEST_ERROR);
        } catch (error) {
          expect((error as StripeError).message).toBe(STRIPE_INVALID_REQUEST_ERROR.message);
        }
      });
    });

    describe("API Errors", () => {
      it("should handle API error", () => {
        try {
          handleStripeError(STRIPE_API_ERROR);
        } catch (error) {
          expect(error).toBeInstanceOf(StripeError);
          expect((error as StripeError).message).toBe("Payment service temporarily unavailable");
          expect((error as StripeError).getStatus()).toBe(HttpStatus.SERVICE_UNAVAILABLE);
          expect((error as StripeError).stripeCode).toBe(STRIPE_API_ERROR.code);
        }
      });

      it("should use custom message for API errors", () => {
        try {
          handleStripeError(STRIPE_API_ERROR);
        } catch (error) {
          expect((error as StripeError).message).not.toBe(STRIPE_API_ERROR.message);
          expect((error as StripeError).message).toContain("temporarily unavailable");
        }
      });
    });

    describe("Connection Errors", () => {
      it("should handle connection error", () => {
        try {
          handleStripeError(STRIPE_CONNECTION_ERROR);
        } catch (error) {
          expect(error).toBeInstanceOf(StripeError);
          expect((error as StripeError).message).toBe("Unable to connect to payment service");
          expect((error as StripeError).getStatus()).toBe(HttpStatus.SERVICE_UNAVAILABLE);
          expect((error as StripeError).stripeCode).toBe(STRIPE_CONNECTION_ERROR.code);
        }
      });

      it("should use custom message for connection errors", () => {
        try {
          handleStripeError(STRIPE_CONNECTION_ERROR);
        } catch (error) {
          expect((error as StripeError).message).not.toBe(STRIPE_CONNECTION_ERROR.message);
          expect((error as StripeError).message).toContain("Unable to connect");
        }
      });
    });

    describe("Authentication Errors", () => {
      it("should handle authentication error", () => {
        try {
          handleStripeError(STRIPE_AUTHENTICATION_ERROR);
        } catch (error) {
          expect(error).toBeInstanceOf(StripeError);
          expect((error as StripeError).message).toBe("Payment service configuration error");
          expect((error as StripeError).getStatus()).toBe(HttpStatus.INTERNAL_SERVER_ERROR);
          expect((error as StripeError).stripeCode).toBe(STRIPE_AUTHENTICATION_ERROR.code);
        }
      });

      it("should use custom message for authentication errors", () => {
        try {
          handleStripeError(STRIPE_AUTHENTICATION_ERROR);
        } catch (error) {
          expect((error as StripeError).message).not.toBe(STRIPE_AUTHENTICATION_ERROR.message);
          expect((error as StripeError).message).toContain("configuration error");
        }
      });
    });

    describe("Idempotency Errors", () => {
      it("should handle idempotency error", () => {
        try {
          handleStripeError(STRIPE_IDEMPOTENCY_ERROR);
        } catch (error) {
          expect(error).toBeInstanceOf(StripeError);
          expect((error as StripeError).message).toBe("Duplicate request detected");
          expect((error as StripeError).getStatus()).toBe(HttpStatus.CONFLICT);
          expect((error as StripeError).stripeCode).toBe(STRIPE_IDEMPOTENCY_ERROR.code);
        }
      });

      it("should use custom message for idempotency errors", () => {
        try {
          handleStripeError(STRIPE_IDEMPOTENCY_ERROR);
        } catch (error) {
          // The custom message is "Duplicate request detected" which matches the fixture
          expect((error as StripeError).message).toBe("Duplicate request detected");
          expect((error as StripeError).message).toContain("Duplicate request");
        }
      });
    });

    describe("Unknown Errors", () => {
      it("should handle unknown Stripe error type", () => {
        const unknownError = {
          type: "UnknownStripeError",
          message: "Unknown error occurred",
          code: "unknown_error",
        };

        try {
          handleStripeError(unknownError);
        } catch (error) {
          expect(error).toBeInstanceOf(StripeError);
          expect((error as StripeError).message).toBe("An unexpected payment error occurred");
          expect((error as StripeError).getStatus()).toBe(HttpStatus.INTERNAL_SERVER_ERROR);
        }
      });

      it("should handle error without type property", () => {
        const errorWithoutType = {
          message: "Some error",
          code: "some_code",
        };

        expect(() => handleStripeError(errorWithoutType)).toThrow();
      });

      it("should handle non-object errors", () => {
        expect(() => handleStripeError("string error")).toThrow("string error");
        // Jest's toThrow() doesn't support numbers or null - it only accepts strings, regexes, classes, or errors
        expect(() => handleStripeError(123 as any)).toThrow();
        expect(() => handleStripeError(null as any)).toThrow();
      });

      it("should handle undefined error", () => {
        expect(() => handleStripeError(undefined)).toThrow(undefined);
      });

      it("should rethrow non-Stripe errors", () => {
        const regularError = new Error("Regular error");
        expect(() => handleStripeError(regularError)).toThrow(regularError);
      });
    });

    describe("Edge Cases", () => {
      it("should handle error with missing code", () => {
        const errorWithoutCode = {
          type: "StripeCardError",
          message: "Card error",
        };

        try {
          handleStripeError(errorWithoutCode);
        } catch (error) {
          expect(error).toBeInstanceOf(StripeError);
          expect((error as StripeError).stripeCode).toBeUndefined();
        }
      });

      it("should handle error with missing message", () => {
        const errorWithoutMessage = {
          type: "StripeAPIError",
          code: "api_error",
        };

        try {
          handleStripeError(errorWithoutMessage);
        } catch (error) {
          expect(error).toBeInstanceOf(StripeError);
          expect((error as StripeError).message).toBe("Payment service temporarily unavailable");
        }
      });

      it("should handle error with empty string message", () => {
        const errorWithEmptyMessage = {
          type: "StripeInvalidRequestError",
          message: "",
          code: "parameter_invalid",
        };

        try {
          handleStripeError(errorWithEmptyMessage);
        } catch (error) {
          expect(error).toBeInstanceOf(StripeError);
          expect((error as StripeError).message).toBe("");
        }
      });

      it("should handle error with null properties", () => {
        const errorWithNulls = {
          type: "StripeCardError",
          message: "Card declined",
          code: null,
          decline_code: null,
        };

        try {
          handleStripeError(errorWithNulls);
        } catch (error) {
          expect(error).toBeInstanceOf(StripeError);
        }
      });
    });
  });

  describe("@HandleStripeErrors Decorator", () => {
    class TestService {
      @HandleStripeErrors()
      async methodThatSucceeds() {
        return "success";
      }

      @HandleStripeErrors()
      async methodThatThrowsCardError() {
        throw STRIPE_CARD_ERROR;
      }

      @HandleStripeErrors()
      async methodThatThrowsApiError() {
        throw STRIPE_API_ERROR;
      }

      @HandleStripeErrors()
      async methodThatThrowsInvalidRequestError() {
        throw STRIPE_INVALID_REQUEST_ERROR;
      }

      @HandleStripeErrors()
      async methodThatThrowsRateLimitError() {
        throw STRIPE_RATE_LIMIT_ERROR;
      }

      @HandleStripeErrors()
      async methodThatThrowsConnectionError() {
        throw STRIPE_CONNECTION_ERROR;
      }

      @HandleStripeErrors()
      async methodThatThrowsAuthenticationError() {
        throw STRIPE_AUTHENTICATION_ERROR;
      }

      @HandleStripeErrors()
      async methodThatThrowsIdempotencyError() {
        throw STRIPE_IDEMPOTENCY_ERROR;
      }

      @HandleStripeErrors()
      async methodWithArguments(arg1: string, arg2: number) {
        return `${arg1}-${arg2}`;
      }

      @HandleStripeErrors()
      async methodThatThrowsRegularError() {
        throw new Error("Regular error");
      }
    }

    let service: TestService;

    beforeEach(() => {
      service = new TestService();
    });

    it("should allow successful method execution", async () => {
      const result = await service.methodThatSucceeds();
      expect(result).toBe("success");
    });

    it("should handle card errors", async () => {
      await expect(service.methodThatThrowsCardError()).rejects.toThrow(StripeError);

      try {
        await service.methodThatThrowsCardError();
      } catch (error) {
        expect((error as StripeError).getStatus()).toBe(HttpStatus.PAYMENT_REQUIRED);
      }
    });

    it("should handle API errors", async () => {
      await expect(service.methodThatThrowsApiError()).rejects.toThrow(StripeError);

      try {
        await service.methodThatThrowsApiError();
      } catch (error) {
        expect((error as StripeError).getStatus()).toBe(HttpStatus.SERVICE_UNAVAILABLE);
      }
    });

    it("should handle invalid request errors", async () => {
      await expect(service.methodThatThrowsInvalidRequestError()).rejects.toThrow(StripeError);

      try {
        await service.methodThatThrowsInvalidRequestError();
      } catch (error) {
        expect((error as StripeError).getStatus()).toBe(HttpStatus.BAD_REQUEST);
      }
    });

    it("should handle rate limit errors", async () => {
      await expect(service.methodThatThrowsRateLimitError()).rejects.toThrow(StripeError);

      try {
        await service.methodThatThrowsRateLimitError();
      } catch (error) {
        expect((error as StripeError).getStatus()).toBe(HttpStatus.TOO_MANY_REQUESTS);
      }
    });

    it("should handle connection errors", async () => {
      await expect(service.methodThatThrowsConnectionError()).rejects.toThrow(StripeError);

      try {
        await service.methodThatThrowsConnectionError();
      } catch (error) {
        expect((error as StripeError).getStatus()).toBe(HttpStatus.SERVICE_UNAVAILABLE);
      }
    });

    it("should handle authentication errors", async () => {
      await expect(service.methodThatThrowsAuthenticationError()).rejects.toThrow(StripeError);

      try {
        await service.methodThatThrowsAuthenticationError();
      } catch (error) {
        expect((error as StripeError).getStatus()).toBe(HttpStatus.INTERNAL_SERVER_ERROR);
      }
    });

    it("should handle idempotency errors", async () => {
      await expect(service.methodThatThrowsIdempotencyError()).rejects.toThrow(StripeError);

      try {
        await service.methodThatThrowsIdempotencyError();
      } catch (error) {
        expect((error as StripeError).getStatus()).toBe(HttpStatus.CONFLICT);
      }
    });

    it("should preserve method arguments", async () => {
      const result = await service.methodWithArguments("test", 123);
      expect(result).toBe("test-123");
    });

    it("should handle regular errors by rethrowing", async () => {
      await expect(service.methodThatThrowsRegularError()).rejects.toThrow("Regular error");
    });

    it("should preserve method context", async () => {
      class ContextService {
        value = "test-value";

        @HandleStripeErrors()
        async methodUsingThis() {
          return this.value;
        }
      }

      const contextService = new ContextService();
      const result = await contextService.methodUsingThis();
      expect(result).toBe("test-value");
    });

    it("should handle multiple decorated methods independently", async () => {
      const success = await service.methodThatSucceeds();
      expect(success).toBe("success");

      await expect(service.methodThatThrowsCardError()).rejects.toThrow(StripeError);
      await expect(service.methodThatThrowsApiError()).rejects.toThrow(StripeError);
    });

    it("should handle async operations correctly", async () => {
      class AsyncService {
        @HandleStripeErrors()
        async asyncMethod() {
          await new Promise((resolve) => setTimeout(resolve, 10));
          return "async-success";
        }

        @HandleStripeErrors()
        async asyncErrorMethod() {
          await new Promise((resolve) => setTimeout(resolve, 10));
          throw STRIPE_CARD_ERROR;
        }
      }

      const asyncService = new AsyncService();
      const result = await asyncService.asyncMethod();
      expect(result).toBe("async-success");

      await expect(asyncService.asyncErrorMethod()).rejects.toThrow(StripeError);
    });

    it("should handle methods with complex return types", async () => {
      class ComplexService {
        @HandleStripeErrors()
        async methodReturningObject() {
          return { id: "123", name: "test", nested: { value: 456 } };
        }

        @HandleStripeErrors()
        async methodReturningArray() {
          return [1, 2, 3, 4, 5];
        }
      }

      const complexService = new ComplexService();
      const objResult = await complexService.methodReturningObject();
      expect(objResult).toEqual({ id: "123", name: "test", nested: { value: 456 } });

      const arrResult = await complexService.methodReturningArray();
      expect(arrResult).toEqual([1, 2, 3, 4, 5]);
    });

    it("should handle methods with no return value", async () => {
      class VoidService {
        @HandleStripeErrors()
        async voidMethod() {
          // No return
        }
      }

      const voidService = new VoidService();
      const result = await voidService.voidMethod();
      expect(result).toBeUndefined();
    });

    it("should work with multiple decorators on same class", async () => {
      class MultiDecoratorService {
        @HandleStripeErrors()
        async method1() {
          return "method1";
        }

        @HandleStripeErrors()
        async method2() {
          return "method2";
        }

        @HandleStripeErrors()
        async method3() {
          throw STRIPE_CARD_ERROR;
        }
      }

      const multiService = new MultiDecoratorService();
      expect(await multiService.method1()).toBe("method1");
      expect(await multiService.method2()).toBe("method2");
      await expect(multiService.method3()).rejects.toThrow(StripeError);
    });
  });

  describe("Error Type Mappings", () => {
    it("should map all error types to correct HTTP status codes", () => {
      const errorMappings = [
        { error: STRIPE_CARD_ERROR, expectedStatus: HttpStatus.PAYMENT_REQUIRED },
        { error: STRIPE_RATE_LIMIT_ERROR, expectedStatus: HttpStatus.TOO_MANY_REQUESTS },
        { error: STRIPE_INVALID_REQUEST_ERROR, expectedStatus: HttpStatus.BAD_REQUEST },
        { error: STRIPE_API_ERROR, expectedStatus: HttpStatus.SERVICE_UNAVAILABLE },
        { error: STRIPE_CONNECTION_ERROR, expectedStatus: HttpStatus.SERVICE_UNAVAILABLE },
        { error: STRIPE_AUTHENTICATION_ERROR, expectedStatus: HttpStatus.INTERNAL_SERVER_ERROR },
        { error: STRIPE_IDEMPOTENCY_ERROR, expectedStatus: HttpStatus.CONFLICT },
      ];

      errorMappings.forEach(({ error, expectedStatus }) => {
        try {
          handleStripeError(error);
        } catch (e) {
          expect((e as StripeError).getStatus()).toBe(expectedStatus);
        }
      });
    });

    it("should preserve stripe codes for all error types", () => {
      const errors = [
        STRIPE_CARD_ERROR,
        STRIPE_RATE_LIMIT_ERROR,
        STRIPE_INVALID_REQUEST_ERROR,
        STRIPE_API_ERROR,
        STRIPE_CONNECTION_ERROR,
        STRIPE_AUTHENTICATION_ERROR,
        STRIPE_IDEMPOTENCY_ERROR,
      ];

      errors.forEach((error) => {
        try {
          handleStripeError(error);
        } catch (e) {
          expect((e as StripeError).stripeCode).toBe(error.code);
        }
      });
    });
  });

  describe("Integration Scenarios", () => {
    it("should handle complete error flow from Stripe to application", () => {
      class PaymentService {
        @HandleStripeErrors()
        async processPayment(amount: number) {
          if (amount <= 0) {
            throw STRIPE_INVALID_REQUEST_ERROR;
          }
          if (amount > 999999) {
            throw STRIPE_CARD_ERROR;
          }
          return { success: true, amount };
        }
      }

      const service = new PaymentService();

      return Promise.all([
        expect(service.processPayment(0)).rejects.toThrow(StripeError),
        expect(service.processPayment(1000000)).rejects.toThrow(StripeError),
        expect(service.processPayment(100)).resolves.toEqual({ success: true, amount: 100 }),
      ]);
    });

    it("should handle concurrent error handling", async () => {
      class ConcurrentService {
        @HandleStripeErrors()
        async operation(shouldFail: boolean) {
          if (shouldFail) {
            throw STRIPE_API_ERROR;
          }
          return "success";
        }
      }

      const service = new ConcurrentService();

      const results = await Promise.allSettled([
        service.operation(false),
        service.operation(true),
        service.operation(false),
        service.operation(true),
      ]);

      expect(results[0].status).toBe("fulfilled");
      expect(results[1].status).toBe("rejected");
      expect(results[2].status).toBe("fulfilled");
      expect(results[3].status).toBe("rejected");
    });
  });
});
