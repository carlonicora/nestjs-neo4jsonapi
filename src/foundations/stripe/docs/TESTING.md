# Stripe Module Testing Guide

Complete guide for testing code that integrates with the Stripe module.

## Table of Contents

- [Test Infrastructure](#test-infrastructure)
- [Mock Utilities](#mock-utilities)
- [Test Fixtures](#test-fixtures)
- [Writing Service Tests](#writing-service-tests)
- [Testing Webhooks](#testing-webhooks)
- [Testing Error Handling](#testing-error-handling)
- [Coverage Requirements](#coverage-requirements)
- [Best Practices](#best-practices)

---

## Test Infrastructure

### Jest Configuration

The Stripe module uses Jest with ts-jest for TypeScript support.

**jest.config.js:**
```javascript
module.exports = {
  preset: 'ts-jest',
  testEnvironment: 'node',
  roots: ['<rootDir>/src'],
  testMatch: ['**/*.spec.ts'],
  collectCoverageFrom: [
    'src/**/*.ts',
    '!src/**/*.interface.ts',
    '!src/**/*.spec.ts',
    '!src/**/__tests__/**/*',
  ],
  coverageThresholds: {
    'src/core/stripe/**/*.ts': {
      branches: 80,
      functions: 80,
      lines: 80,
      statements: 80,
    },
  },
};
```

### Running Tests

```bash
# Run all Stripe tests
pnpm test:stripe

# Run tests in watch mode
pnpm test:stripe -- --watch

# Run with coverage
pnpm test:cov --testPathPattern=stripe

# Run specific test file
pnpm test src/core/stripe/services/stripe.customer.service.spec.ts
```

---

## Mock Utilities

### Mock Stripe Client

The module provides a complete mock of the Stripe SDK via `createMockStripeClient()`.

**Location:** `src/core/stripe/__tests__/mocks/stripe.mock.ts`

**Usage:**
```typescript
import { createMockStripeClient } from './core/stripe/__tests__/mocks/stripe.mock';

describe('MyService', () => {
  let mockStripe: any;

  beforeEach(() => {
    mockStripe = createMockStripeClient();

    // Configure mocks
    mockStripe.customers.create.mockResolvedValue(MOCK_CUSTOMER);
    mockStripe.subscriptions.retrieve.mockResolvedValue(MOCK_SUBSCRIPTION);
  });
});
```

### Available Mock Methods

The mock client includes all commonly used Stripe SDK methods:

```typescript
{
  // Customers
  customers: {
    create, retrieve, update, del, list
  },

  // Subscriptions
  subscriptions: {
    create, retrieve, update, cancel, pause, resume, list
  },

  // Products & Prices
  products: { create, retrieve, update, list },
  prices: { create, retrieve, update, list },

  // Payments
  paymentIntents: { create, retrieve, confirm, cancel },
  setupIntents: { create, retrieve },
  paymentMethods: { retrieve, list, attach, detach },

  // Invoices
  invoices: {
    retrieve, list, pay, voidInvoice,
    retrieveUpcoming, createPreview
  },

  // Billing Portal
  billingPortal: {
    sessions: { create }
  },

  // Webhooks
  webhooks: {
    constructEvent
  },

  // Usage-Based Billing (v2 API)
  v2: {
    billing: {
      meterEvents: { create },
      meterEventSummaries: { list }
    }
  },

  // Billing Meters (v1 API)
  billing: {
    meters: { list, retrieve, listEventSummaries }
  }
}
```

---

## Test Fixtures

### Using Fixtures

The module provides pre-configured test data that matches Stripe SDK types.

**Location:** `src/core/stripe/__tests__/fixtures/stripe.fixtures.ts`

**Available Fixtures:**

```typescript
import {
  MOCK_CUSTOMER,
  MOCK_PAYMENT_METHOD,
  MOCK_PRODUCT,
  MOCK_PRICE_RECURRING,
  MOCK_PRICE_ONE_TIME,
  MOCK_SUBSCRIPTION,
  MOCK_PAYMENT_INTENT,
  MOCK_SETUP_INTENT,
  MOCK_INVOICE,
  MOCK_WEBHOOK_EVENT,
  MOCK_PORTAL_SESSION,
  MOCK_DISPUTE,
  TEST_IDS,
  STRIPE_CARD_ERROR,
  STRIPE_INVALID_REQUEST_ERROR,
  STRIPE_API_ERROR,
  STRIPE_RATE_LIMIT_ERROR,
  STRIPE_AUTH_ERROR,
  STRIPE_IDEMPOTENCY_ERROR,
} from './core/stripe/__tests__/fixtures/stripe.fixtures';
```

### Fixture Examples

**Customer Fixture:**
```typescript
const MOCK_CUSTOMER: Stripe.Customer = {
  id: 'cus_test_12345678',
  email: 'test@example.com',
  name: 'Test Customer',
  metadata: { companyId: 'company_123' },
  // ... complete Stripe.Customer structure
};
```

**Subscription Fixture:**
```typescript
const MOCK_SUBSCRIPTION: Stripe.Subscription = {
  id: 'sub_test_12345678',
  customer: 'cus_test_12345678',
  status: 'active',
  items: {
    data: [{ price: MOCK_PRICE_RECURRING, quantity: 1 }]
  },
  // ... complete Stripe.Subscription structure
};
```

### Test IDs

Consistent test IDs for relationships:

```typescript
const TEST_IDS = {
  customerId: 'cus_test_12345678',
  subscriptionId: 'sub_test_12345678',
  productId: 'prod_test_12345678',
  priceId: 'price_test_12345678',
  paymentMethodId: 'pm_test_12345678',
  paymentIntentId: 'pi_test_12345678',
  invoiceId: 'in_test_12345678',
  disputeId: 'dp_test_12345678',
};
```

---

## Writing Service Tests

### Basic Test Structure

```typescript
import { Test, TestingModule } from '@nestjs/testing';
import { StripeCustomerService } from './stripe.customer.service';
import { StripeService } from './stripe.service';
import { createMockStripeClient } from '../__tests__/mocks/stripe.mock';
import { MOCK_CUSTOMER } from '../__tests__/fixtures/stripe.fixtures';

describe('StripeCustomerService', () => {
  let service: StripeCustomerService;
  let stripeService: jest.Mocked<StripeService>;
  let mockStripe: any;

  beforeEach(async () => {
    // Create mock Stripe client
    mockStripe = createMockStripeClient();

    // Create testing module
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        StripeCustomerService,
        {
          provide: StripeService,
          useValue: {
            getClient: jest.fn().mockReturnValue(mockStripe),
            isConfigured: jest.fn().mockReturnValue(true),
          },
        },
      ],
    }).compile();

    service = module.get<StripeCustomerService>(StripeCustomerService);
    stripeService = module.get(StripeService);
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  describe('createCustomer', () => {
    it('should create customer with valid params', async () => {
      // Arrange
      mockStripe.customers.create.mockResolvedValue(MOCK_CUSTOMER);

      // Act
      const result = await service.createCustomer({
        companyId: 'company_123',
        email: 'test@example.com',
        name: 'Test Customer',
      });

      // Assert
      expect(result).toEqual(MOCK_CUSTOMER);
      expect(mockStripe.customers.create).toHaveBeenCalledWith({
        email: 'test@example.com',
        name: 'Test Customer',
        metadata: { companyId: 'company_123' },
      });
    });

    it('should handle Stripe errors', async () => {
      // Arrange
      mockStripe.customers.create.mockRejectedValue({
        type: 'StripeInvalidRequestError',
        message: 'Invalid email',
      });

      // Act & Assert
      await expect(
        service.createCustomer({
          companyId: 'company_123',
          email: 'invalid-email',
          name: 'Test',
        })
      ).rejects.toThrow();
    });
  });
});
```

### Testing Services That Use Multiple Stripe Methods

```typescript
describe('createSubscription', () => {
  it('should create subscription with payment method', async () => {
    // Arrange
    mockStripe.subscriptions.create.mockResolvedValue(MOCK_SUBSCRIPTION);

    // Act
    const result = await service.createSubscription({
      stripeCustomerId: 'cus_123',
      priceId: 'price_123',
      paymentMethodId: 'pm_123',
    });

    // Assert
    expect(result).toEqual(MOCK_SUBSCRIPTION);
    expect(mockStripe.subscriptions.create).toHaveBeenCalledWith(
      expect.objectContaining({
        customer: 'cus_123',
        items: [{ price: 'price_123' }],
        default_payment_method: 'pm_123',
      })
    );
  });

  it('should create subscription without payment method if customer has default', async () => {
    // Arrange
    mockStripe.subscriptions.create.mockResolvedValue(MOCK_SUBSCRIPTION);

    // Act
    await service.createSubscription({
      stripeCustomerId: 'cus_123',
      priceId: 'price_123',
      // No paymentMethodId
    });

    // Assert
    expect(mockStripe.subscriptions.create).toHaveBeenCalledWith(
      expect.not.objectContaining({
        default_payment_method: expect.anything(),
      })
    );
  });
});
```

### Testing Optional Parameters

```typescript
describe('optional parameters', () => {
  it('should include trial period when provided', async () => {
    mockStripe.subscriptions.create.mockResolvedValue(MOCK_SUBSCRIPTION);

    await service.createSubscription({
      stripeCustomerId: 'cus_123',
      priceId: 'price_123',
      trialPeriodDays: 14,
    });

    expect(mockStripe.subscriptions.create).toHaveBeenCalledWith(
      expect.objectContaining({
        trial_period_days: 14,
      })
    );
  });

  it('should not include trial period when set to 0', async () => {
    mockStripe.subscriptions.create.mockResolvedValue(MOCK_SUBSCRIPTION);

    await service.createSubscription({
      stripeCustomerId: 'cus_123',
      priceId: 'price_123',
      trialPeriodDays: 0,  // Falsy value
    });

    // 0 is falsy, so it should not be included
    expect(mockStripe.subscriptions.create).toHaveBeenCalledWith(
      expect.not.objectContaining({
        trial_period_days: 0,
      })
    );
  });
});
```

---

## Testing Webhooks

### Testing Webhook Verification

```typescript
import { StripeWebhookService } from './stripe.webhook.service';
import { MOCK_WEBHOOK_EVENT } from '../__tests__/fixtures/stripe.fixtures';

describe('StripeWebhookService', () => {
  let service: StripeWebhookService;
  let mockStripe: any;

  beforeEach(async () => {
    mockStripe = createMockStripeClient();

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        StripeWebhookService,
        {
          provide: StripeService,
          useValue: {
            getClient: jest.fn().mockReturnValue(mockStripe),
            getWebhookSecret: jest.fn().mockReturnValue('whsec_test_123'),
          },
        },
      ],
    }).compile();

    service = module.get<StripeWebhookService>(StripeWebhookService);
  });

  describe('constructEvent', () => {
    it('should verify and construct webhook event', () => {
      // Arrange
      const payload = Buffer.from(JSON.stringify(MOCK_WEBHOOK_EVENT));
      const signature = 'test_signature';

      mockStripe.webhooks.constructEvent.mockReturnValue(MOCK_WEBHOOK_EVENT);

      // Act
      const event = service.constructEvent(payload, signature);

      // Assert
      expect(event).toEqual(MOCK_WEBHOOK_EVENT);
      expect(mockStripe.webhooks.constructEvent).toHaveBeenCalledWith(
        payload,
        signature,
        'whsec_test_123'
      );
    });

    it('should throw error for invalid signature', () => {
      // Arrange
      mockStripe.webhooks.constructEvent.mockImplementation(() => {
        throw new Error('Invalid signature');
      });

      // Act & Assert
      expect(() =>
        service.constructEvent(Buffer.from('{}'), 'invalid_signature')
      ).toThrow('Invalid signature');
    });
  });

  describe('event categorization', () => {
    it('should identify subscription events', () => {
      expect(service.isSubscriptionEvent('customer.subscription.created')).toBe(true);
      expect(service.isSubscriptionEvent('customer.subscription.updated')).toBe(true);
      expect(service.isSubscriptionEvent('invoice.paid')).toBe(false);
    });

    it('should identify invoice events', () => {
      expect(service.isInvoiceEvent('invoice.paid')).toBe(true);
      expect(service.isInvoiceEvent('invoice.payment_failed')).toBe(true);
      expect(service.isInvoiceEvent('customer.created')).toBe(false);
    });

    it('should be case-sensitive', () => {
      expect(service.isPaymentEvent('payment_intent.succeeded')).toBe(true);
      expect(service.isPaymentEvent('PAYMENT_INTENT.succeeded')).toBe(false);
    });
  });
});
```

---

## Testing Error Handling

### Testing @HandleStripeErrors Decorator

```typescript
import { handleStripeError } from './stripe.errors';
import {
  STRIPE_CARD_ERROR,
  STRIPE_RATE_LIMIT_ERROR,
  STRIPE_INVALID_REQUEST_ERROR,
} from '../__tests__/fixtures/stripe.fixtures';

describe('handleStripeError', () => {
  it('should transform card errors to 402 status', () => {
    expect(() => handleStripeError(STRIPE_CARD_ERROR)).toThrow(
      expect.objectContaining({
        message: 'Your card was declined',
        statusCode: 402,
      })
    );
  });

  it('should transform rate limit errors to 429 status', () => {
    expect(() => handleStripeError(STRIPE_RATE_LIMIT_ERROR)).toThrow(
      expect.objectContaining({
        message: 'Too many requests',
        statusCode: 429,
      })
    );
  });

  it('should transform invalid request errors to 400 status', () => {
    expect(() => handleStripeError(STRIPE_INVALID_REQUEST_ERROR)).toThrow(
      expect.objectContaining({
        message: 'Invalid request',
        statusCode: 400,
      })
    );
  });

  it('should handle unknown errors', () => {
    const unknownError = { type: 'UnknownError', message: 'Something went wrong' };

    expect(() => handleStripeError(unknownError)).toThrow(
      expect.objectContaining({
        statusCode: 500,
      })
    );
  });
});
```

### Testing Service Error Handling

```typescript
describe('error handling in services', () => {
  it('should propagate Stripe errors through decorator', async () => {
    // Arrange
    mockStripe.customers.create.mockRejectedValue(STRIPE_CARD_ERROR);

    // Act & Assert
    await expect(
      service.createCustomer({
        companyId: 'company_123',
        email: 'test@example.com',
        name: 'Test',
      })
    ).rejects.toThrow(
      expect.objectContaining({
        statusCode: 402,
      })
    );
  });

  it('should preserve error details', async () => {
    // Arrange
    const error = {
      type: 'StripeInvalidRequestError',
      message: 'Invalid email format',
      code: 'email_invalid',
      param: 'email',
    };

    mockStripe.customers.create.mockRejectedValue(error);

    // Act & Assert
    try {
      await service.createCustomer({
        companyId: 'company_123',
        email: 'invalid-email',
        name: 'Test',
      });
      fail('Should have thrown error');
    } catch (e) {
      expect(e.code).toBe('email_invalid');
      expect(e.param).toBe('email');
    }
  });
});
```

---

## Coverage Requirements

### Module Coverage Thresholds

The Stripe module enforces 80% coverage across all metrics:

```javascript
coverageThresholds: {
  'src/core/stripe/**/*.ts': {
    branches: 80,
    functions: 80,
    lines: 80,
    statements: 80,
  },
},
```

### Checking Coverage

```bash
# Generate coverage report
pnpm test:cov --testPathPattern=stripe

# View coverage in browser
open coverage/lcov-report/index.html
```

### Coverage Report Example

```
--------------------------------|---------|----------|---------|---------
File                            | % Stmts | % Branch | % Funcs | % Lines
--------------------------------|---------|----------|---------|---------
All files                       |   96.1  |   76.55  |  95.52  |  95.66
 stripe/services                |   96.1  |   76.55  |  95.52  |  95.66
  stripe.customer.service.ts    |    100  |   76.74  |    100  |    100
  stripe.invoice.service.ts     |    100  |   78.12  |    100  |    100
  stripe.payment.service.ts     |    100  |   76.47  |    100  |    100
  stripe.subscription.service.ts|    100  |   78.18  |    100  |    100
--------------------------------|---------|----------|---------|---------
```

---

## Best Practices

### 1. Use Fixtures for Consistency

```typescript
// GOOD: Use fixtures
const result = await service.createCustomer({...});
expect(result).toEqual(MOCK_CUSTOMER);

// BAD: Inline mock data
expect(result).toEqual({
  id: 'cus_123',
  email: 'test@example.com',
  // ... incomplete structure
});
```

### 2. Test Happy Path and Error Cases

```typescript
describe('createCustomer', () => {
  // Happy path
  it('should create customer successfully', async () => {
    mockStripe.customers.create.mockResolvedValue(MOCK_CUSTOMER);
    const result = await service.createCustomer({...});
    expect(result).toBeDefined();
  });

  // Error cases
  it('should handle card errors', async () => {
    mockStripe.customers.create.mockRejectedValue(STRIPE_CARD_ERROR);
    await expect(service.createCustomer({...})).rejects.toThrow();
  });

  it('should handle invalid requests', async () => {
    mockStripe.customers.create.mockRejectedValue(STRIPE_INVALID_REQUEST_ERROR);
    await expect(service.createCustomer({...})).rejects.toThrow();
  });
});
```

### 3. Test Edge Cases

```typescript
describe('edge cases', () => {
  it('should handle null/undefined parameters', async () => {
    await expect(
      service.createCustomer({
        companyId: 'company_123',
        email: null,  // Edge case
        name: 'Test',
      })
    ).rejects.toThrow();
  });

  it('should handle empty results', async () => {
    mockStripe.customers.list.mockResolvedValue({ data: [] });
    const result = await service.listCustomers();
    expect(result).toEqual([]);
  });
});
```

### 4. Verify Method Calls

```typescript
it('should call Stripe SDK with correct parameters', async () => {
  mockStripe.subscriptions.create.mockResolvedValue(MOCK_SUBSCRIPTION);

  await service.createSubscription({
    stripeCustomerId: 'cus_123',
    priceId: 'price_123',
  });

  expect(mockStripe.subscriptions.create).toHaveBeenCalledTimes(1);
  expect(mockStripe.subscriptions.create).toHaveBeenCalledWith(
    expect.objectContaining({
      customer: 'cus_123',
      items: [{ price: 'price_123' }],
    })
  );
});
```

### 5. Clean Up After Tests

```typescript
afterEach(() => {
  jest.clearAllMocks();  // Clear mock call history
});

afterAll(() => {
  jest.restoreAllMocks();  // Restore original implementations
});
```

### 6. Use Descriptive Test Names

```typescript
// GOOD: Descriptive
it('should create subscription with trial period when trialPeriodDays is provided', () => {});
it('should exclude trial period when trialPeriodDays is 0 (falsy)', () => {});

// BAD: Vague
it('should work', () => {});
it('test subscription', () => {});
```

---

## Example: Complete Service Test

```typescript
import { Test, TestingModule } from '@nestjs/testing';
import { StripeCustomerService } from './stripe.customer.service';
import { StripeService } from './stripe.service';
import { createMockStripeClient } from '../__tests__/mocks/stripe.mock';
import {
  MOCK_CUSTOMER,
  MOCK_PAYMENT_METHOD,
  STRIPE_CARD_ERROR,
  TEST_IDS,
} from '../__tests__/fixtures/stripe.fixtures';

describe('StripeCustomerService', () => {
  let service: StripeCustomerService;
  let mockStripe: any;

  beforeEach(async () => {
    mockStripe = createMockStripeClient();

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        StripeCustomerService,
        {
          provide: StripeService,
          useValue: {
            getClient: jest.fn().mockReturnValue(mockStripe),
            isConfigured: jest.fn().mockReturnValue(true),
          },
        },
      ],
    }).compile();

    service = module.get<StripeCustomerService>(StripeCustomerService);
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  describe('createCustomer', () => {
    it('should create customer with required fields', async () => {
      mockStripe.customers.create.mockResolvedValue(MOCK_CUSTOMER);

      const result = await service.createCustomer({
        companyId: 'company_123',
        email: 'test@example.com',
        name: 'Test Customer',
      });

      expect(result).toEqual(MOCK_CUSTOMER);
      expect(mockStripe.customers.create).toHaveBeenCalledWith({
        email: 'test@example.com',
        name: 'Test Customer',
        metadata: { companyId: 'company_123' },
      });
    });

    it('should include optional fields when provided', async () => {
      mockStripe.customers.create.mockResolvedValue(MOCK_CUSTOMER);

      await service.createCustomer({
        companyId: 'company_123',
        email: 'test@example.com',
        name: 'Test Customer',
        phone: '+1234567890',
        description: 'Premium customer',
        metadata: { plan: 'pro' },
      });

      expect(mockStripe.customers.create).toHaveBeenCalledWith(
        expect.objectContaining({
          phone: '+1234567890',
          description: 'Premium customer',
          metadata: {
            companyId: 'company_123',
            plan: 'pro',
          },
        })
      );
    });

    it('should handle Stripe card errors', async () => {
      mockStripe.customers.create.mockRejectedValue(STRIPE_CARD_ERROR);

      await expect(
        service.createCustomer({
          companyId: 'company_123',
          email: 'test@example.com',
          name: 'Test',
        })
      ).rejects.toThrow();
    });
  });

  describe('attachPaymentMethod', () => {
    it('should attach and set payment method as default', async () => {
      mockStripe.paymentMethods.attach.mockResolvedValue(MOCK_PAYMENT_METHOD);
      mockStripe.customers.update.mockResolvedValue(MOCK_CUSTOMER);

      await service.attachPaymentMethod({
        stripeCustomerId: TEST_IDS.customerId,
        paymentMethodId: TEST_IDS.paymentMethodId,
        setAsDefault: true,
      });

      expect(mockStripe.paymentMethods.attach).toHaveBeenCalledWith(
        TEST_IDS.paymentMethodId,
        { customer: TEST_IDS.customerId }
      );

      expect(mockStripe.customers.update).toHaveBeenCalledWith(
        TEST_IDS.customerId,
        { invoice_settings: { default_payment_method: TEST_IDS.paymentMethodId } }
      );
    });

    it('should attach without setting as default', async () => {
      mockStripe.paymentMethods.attach.mockResolvedValue(MOCK_PAYMENT_METHOD);

      await service.attachPaymentMethod({
        stripeCustomerId: TEST_IDS.customerId,
        paymentMethodId: TEST_IDS.paymentMethodId,
        setAsDefault: false,
      });

      expect(mockStripe.paymentMethods.attach).toHaveBeenCalled();
      expect(mockStripe.customers.update).not.toHaveBeenCalled();
    });
  });
});
```

---

## See Also

- [API Reference](API.md) - Complete API documentation
- [Examples](EXAMPLES.md) - Real-world usage examples
- [Webhook Guide](WEBHOOKS.md) - Webhook implementation guide
- [Main README](../README.md) - Module overview
