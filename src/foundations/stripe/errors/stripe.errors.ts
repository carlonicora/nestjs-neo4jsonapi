import { HttpException, HttpStatus } from "@nestjs/common";

export class StripeError extends HttpException {
  public readonly stripeCode?: string;
  public readonly declineCode?: string;

  constructor(message: string, status: HttpStatus, stripeCode?: string, declineCode?: string) {
    super({ message, stripeCode, declineCode }, status);
    this.stripeCode = stripeCode;
    this.declineCode = declineCode;
  }
}

export function handleStripeError(error: unknown): never {
  // Type guard to check if Stripe is available and error is a StripeError
  if (error && typeof error === "object" && "type" in error) {
    const stripeError = error as any;

    switch (stripeError.type) {
      case "StripeCardError":
        throw new StripeError(
          stripeError.message,
          HttpStatus.PAYMENT_REQUIRED,
          stripeError.code,
          stripeError.decline_code,
        );
      case "StripeRateLimitError":
        throw new StripeError(
          "Too many requests to payment service. Please try again later.",
          HttpStatus.TOO_MANY_REQUESTS,
          stripeError.code,
        );
      case "StripeInvalidRequestError":
        throw new StripeError(stripeError.message, HttpStatus.BAD_REQUEST, stripeError.code);
      case "StripeAPIError":
        throw new StripeError(
          "Payment service temporarily unavailable",
          HttpStatus.SERVICE_UNAVAILABLE,
          stripeError.code,
        );
      case "StripeConnectionError":
        throw new StripeError("Unable to connect to payment service", HttpStatus.SERVICE_UNAVAILABLE, stripeError.code);
      case "StripeAuthenticationError":
        throw new StripeError(
          "Payment service configuration error",
          HttpStatus.INTERNAL_SERVER_ERROR,
          stripeError.code,
        );
      case "StripeIdempotencyError":
        throw new StripeError("Duplicate request detected", HttpStatus.CONFLICT, stripeError.code);
      default:
        throw new StripeError(
          "An unexpected payment error occurred",
          HttpStatus.INTERNAL_SERVER_ERROR,
          stripeError.code,
        );
    }
  }
  throw error;
}

export function HandleStripeErrors() {
  return function (target: any, propertyKey: string, descriptor: PropertyDescriptor) {
    const originalMethod = descriptor.value;
    descriptor.value = async function (...args: any[]) {
      try {
        return await originalMethod.apply(this, args);
      } catch (error) {
        handleStripeError(error);
      }
    };
    return descriptor;
  };
}
