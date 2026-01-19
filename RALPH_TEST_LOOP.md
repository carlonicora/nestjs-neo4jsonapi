# Unit Test Implementation Loop

You are implementing unit tests for all files in `@packages/nestjs-neo4jsonapi/TEST-COVERAGE-GAPS.md`.

---

## COMPLETION CRITERIA

**The loop terminates when one of these conditions is met:**

1. **ALL TESTS COMPLETE** - No unchecked `- [ ]` items remain in the checklist
2. **BLOCKED** - Same error occurs 3 times for one file
3. **MAX ITERATIONS** - Safety limit reached

---

## Step 1: Check Progress

Read `@packages/nestjs-neo4jsonapi/TEST-COVERAGE-GAPS.md` and find the **FIRST** line with `- [ ]` (unchecked item).

**If NO unchecked items remain:**

```
<promise>ALL_TESTS_COMPLETE</promise>
```

Stop immediately. Do not continue.

**If an unchecked item exists:** Continue to Step 2.

---

## Step 2: Read the Source File

Read the file path from the unchecked item. Analyze it thoroughly:

1. **Identify the class/function** being tested
2. **List all public methods** that need tests
3. **Identify dependencies** (injected services, repositories, guards)
4. **Note any decorators** (@UseGuards, @Injectable, etc.)

---

## Step 3: Check for EXISTING Mock Factories

**CRITICAL: ALWAYS check for reusable mocks BEFORE creating new ones.**

### Step 3a: Search for Existing Mocks

Search the codebase for existing mock factories that match your dependencies:

```bash
# Find existing mock factories
find packages/nestjs-neo4jsonapi/src -name "*.mock.ts" -o -name "*mocks*"

# Search for createMock patterns
grep -r "createMock" packages/nestjs-neo4jsonapi/src --include="*.ts"
```

### Step 3b: Known Mock Locations

**ALWAYS check these locations first:**

| Mock                | Location                                                | Usage                      |
| ------------------- | ------------------------------------------------------- | -------------------------- |
| Stripe Client       | `src/foundations/stripe/__tests__/mocks/stripe.mock.ts` | `createMockStripeClient()` |
| Common Test Helpers | `src/__tests__/helpers/`                                | Shared test utilities      |

### Step 3c: Mock Reuse Rules

1. **REUSE** existing mock factories - never duplicate mock definitions
2. **EXTEND** existing mocks if you need additional methods
3. **CREATE** new mocks in `src/__tests__/mocks/` only if no suitable mock exists
4. **IMPORT** from centralized locations, never inline complex mocks

---

## Step 4: Create/Update Shared Mocks (If Needed)

If no suitable mock exists, create one in the appropriate location:

### Directory Structure

```
src/
├── __tests__/
│   ├── mocks/
│   │   ├── neo4j.mock.ts          # Neo4j service mock
│   │   ├── cache.mock.ts          # Cache service mock
│   │   ├── jsonapi.mock.ts        # JSON:API service mock
│   │   ├── repository.mock.ts     # Generic repository mock
│   │   ├── user.mock.ts           # User/auth mock data
│   │   └── index.ts               # Re-exports all mocks
│   ├── fixtures/
│   │   ├── entities.fixtures.ts   # Common entity fixtures
│   │   ├── requests.fixtures.ts   # Request/response fixtures
│   │   └── index.ts               # Re-exports all fixtures
│   └── helpers/
│       ├── test-module.helper.ts  # NestJS test module setup
│       └── index.ts               # Re-exports all helpers
```

### Standard Mock Factory Pattern

```typescript
// src/__tests__/mocks/cache.mock.ts
import { vi } from "vitest";

export const createMockCacheService = () => ({
  get: vi.fn(),
  set: vi.fn(),
  del: vi.fn(),
  invalidateByType: vi.fn(),
  invalidateByElement: vi.fn(),
});

export type MockCacheService = ReturnType<typeof createMockCacheService>;
```

### Standard Fixtures Pattern

```typescript
// src/__tests__/fixtures/user.fixtures.ts
export const TEST_IDS = {
  companyId: "550e8400-e29b-41d4-a716-446655440000",
  userId: "660e8400-e29b-41d4-a716-446655440001",
  adminRoleId: "770e8400-e29b-41d4-a716-446655440002",
};

export const MOCK_ADMIN_USER = {
  userId: TEST_IDS.userId,
  companyId: TEST_IDS.companyId,
  roles: [{ id: TEST_IDS.adminRoleId, name: "Administrator" }],
  language: "en",
  isAdministrator: true,
};

export const MOCK_REGULAR_USER = {
  userId: TEST_IDS.userId,
  companyId: TEST_IDS.companyId,
  roles: [],
  language: "en",
  isAdministrator: false,
};
```

---

## Step 5: Define Test Cases

For each public method, define tests covering:

1. **Happy path** - Normal successful operation
2. **Edge cases** - Empty arrays, null values, boundary conditions
3. **Error handling** - What happens when dependencies throw
4. **Authorization** (controllers only) - Admin vs regular user access

Document your test plan as comments before implementing.

---

## Step 6: Implement the Test File

Create the `.spec.ts` file adjacent to the source file.

### Required Test Structure

```typescript
import { describe, it, expect, beforeEach, afterEach, vi, MockedObject } from "vitest";
import { Test, TestingModule } from "@nestjs/testing";

// CRITICAL: Import from centralized mocks - NEVER inline complex mocks
import { createMockCacheService, MockCacheService } from "../../../__tests__/mocks/cache.mock";
import { createMockNeo4jService } from "../../../__tests__/mocks/neo4j.mock";
import { TEST_IDS, MOCK_ADMIN_USER, MOCK_REGULAR_USER } from "../../../__tests__/fixtures/user.fixtures";

// Import the class being tested
import { MyService } from "./my.service";
import { MyRepository } from "./my.repository";

describe("MyService", () => {
  let service: MyService;
  let repository: MockedObject<MyRepository>;
  let cacheService: MockCacheService;

  beforeEach(async () => {
    // Use factory functions - NEVER define mocks inline
    const mockRepository = {
      find: vi.fn(),
      findOne: vi.fn(),
      create: vi.fn(),
      update: vi.fn(),
      delete: vi.fn(),
    };

    cacheService = createMockCacheService();

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        MyService,
        { provide: MyRepository, useValue: mockRepository },
        { provide: CacheService, useValue: cacheService },
      ],
    }).compile();

    service = module.get<MyService>(MyService);
    repository = module.get(MyRepository);
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  describe("methodName", () => {
    it("should return expected result on success", async () => {
      // Arrange
      const expected = { id: TEST_IDS.companyId, name: "Test" };
      repository.findOne.mockResolvedValue(expected);

      // Act
      const result = await service.methodName(TEST_IDS.companyId);

      // Assert
      expect(repository.findOne).toHaveBeenCalledWith(TEST_IDS.companyId);
      expect(result).toEqual(expected);
    });

    it("should handle errors from dependency", async () => {
      // Arrange
      repository.findOne.mockRejectedValue(new Error("Database error"));

      // Act & Assert
      await expect(service.methodName(TEST_IDS.companyId)).rejects.toThrow("Database error");
    });
  });
});
```

---

## Step 7: Run the Tests

Execute the test file:

```bash
pnpm --filter @carlonicora/nestjs-neo4jsonapi test src/path/to/file.spec.ts
```

---

## Step 8: Fix Failures

If tests fail:

1. Read the error message carefully
2. Fix the test or implementation issue
3. Re-run the tests
4. Repeat until all tests pass

**IMPORTANT:** Track failure count per file.

If tests fail **3 times with the same error**:

```
<promise>BLOCKED: [filename] - [error description]</promise>
```

Stop immediately. Do not continue to the next file.

---

## Step 9: Lint the project

run

```
pnpm lint
```

to ensure no errors have been left behind

---

## Step 10: Mark Complete

When all tests pass, update `@packages/nestjs-neo4jsonapi/TEST-COVERAGE-GAPS.md`:

- Change `- [ ]` to `- [x]` for the completed file

---

## Step 10: Clear Context (MANDATORY)

**CRITICAL: Execute `/clear` after EACH file is completed.**

This is NOT optional. Context bloat will crash the system.

After marking the file complete, your FINAL action MUST be:

```
/clear
```

Do NOT continue reasoning. Do NOT explain anything else. Just run `/clear`.

The Ralph loop will automatically feed this prompt back after the clear.

---

## File Type Specific Patterns

### Controllers

```typescript
import { JwtAuthGuard } from "../../../common/guards/jwt.auth.guard";
import { AdminJwtAuthGuard } from "../../../common/guards/jwt.auth.admin.guard";
import { MOCK_ADMIN_USER, MOCK_REGULAR_USER } from "../../../__tests__/fixtures/user.fixtures";
import { createMockFastifyReply } from "../../../__tests__/mocks/fastify.mock";

describe("MyController", () => {
  let controller: MyController;
  let mockReply: ReturnType<typeof createMockFastifyReply>;

  beforeEach(async () => {
    mockReply = createMockFastifyReply();

    const module = await Test.createTestingModule({
      controllers: [MyController],
      providers: [{ provide: MyService, useValue: createMockMyService() }],
    })
      .overrideGuard(JwtAuthGuard)
      .useValue({ canActivate: () => true })
      .overrideGuard(AdminJwtAuthGuard)
      .useValue({ canActivate: () => true })
      .compile();

    controller = module.get<MyController>(MyController);
  });

  it("should allow admin access", async () => {
    const request = { user: MOCK_ADMIN_USER } as AuthenticatedRequest;
    // ... test admin flow
  });

  it("should deny regular user access to admin endpoints", async () => {
    const request = { user: MOCK_REGULAR_USER } as AuthenticatedRequest;
    // ... test authorization rejection
  });
});
```

### Services

```typescript
import { createMockRepository } from "../../../__tests__/mocks/repository.mock";
import { createMockCacheService } from "../../../__tests__/mocks/cache.mock";

describe("MyService", () => {
  beforeEach(async () => {
    const module = await Test.createTestingModule({
      providers: [
        MyService,
        { provide: MyRepository, useValue: createMockRepository() },
        { provide: CacheService, useValue: createMockCacheService() },
      ],
    }).compile();
  });
});
```

### Repositories

```typescript
import { createMockNeo4jService } from "../../../__tests__/mocks/neo4j.mock";

describe("MyRepository", () => {
  let repository: MyRepository;
  let neo4jService: ReturnType<typeof createMockNeo4jService>;

  beforeEach(async () => {
    neo4jService = createMockNeo4jService();

    const module = await Test.createTestingModule({
      providers: [MyRepository, { provide: Neo4jService, useValue: neo4jService }],
    }).compile();

    repository = module.get<MyRepository>(MyRepository);
  });

  it("should execute cypher query with correct parameters", async () => {
    neo4jService.run.mockResolvedValue([{ id: "123" }]);

    await repository.findOne("123");

    expect(neo4jService.run).toHaveBeenCalledWith(
      expect.stringContaining("MATCH"),
      expect.objectContaining({ id: "123" }),
    );
  });
});
```

### Guards

```typescript
import { createMockExecutionContext } from "../../../__tests__/mocks/execution-context.mock";
import { createMockJwtService } from "../../../__tests__/mocks/jwt.mock";

describe("JwtAuthGuard", () => {
  it("should allow valid token", async () => {
    const context = createMockExecutionContext({
      headers: { authorization: "Bearer valid-token" },
    });
    jwtService.verify.mockReturnValue({ userId: TEST_IDS.userId });

    const result = await guard.canActivate(context);

    expect(result).toBe(true);
  });

  it("should reject invalid token", async () => {
    const context = createMockExecutionContext({
      headers: { authorization: "Bearer invalid-token" },
    });
    jwtService.verify.mockImplementation(() => {
      throw new Error("Invalid token");
    });

    await expect(guard.canActivate(context)).rejects.toThrow();
  });
});
```

### Interceptors

```typescript
import { createMockExecutionContext, createMockCallHandler } from "../../../__tests__/mocks/interceptor.mock";

describe("LoggingInterceptor", () => {
  it("should log request and response", async () => {
    const context = createMockExecutionContext();
    const callHandler = createMockCallHandler({ data: "response" });

    await interceptor.intercept(context, callHandler).toPromise();

    expect(loggingService.log).toHaveBeenCalled();
  });
});
```

### Processors (BullMQ)

```typescript
import { createMockJob } from "../../../__tests__/mocks/bullmq.mock";

describe("MyProcessor", () => {
  it("should process job successfully", async () => {
    const job = createMockJob({
      id: "job-123",
      data: { companyId: TEST_IDS.companyId },
    });

    await processor.process(job);

    expect(myService.processData).toHaveBeenCalledWith(TEST_IDS.companyId);
  });

  it("should handle job failure gracefully", async () => {
    const job = createMockJob({ data: { companyId: "invalid" } });
    myService.processData.mockRejectedValue(new Error("Process failed"));

    await expect(processor.process(job)).rejects.toThrow("Process failed");
  });
});
```

---

## Mock Factory Checklist

Before writing any test, verify you have checked for these common mocks:

- [ ] `createMockCacheService()` - CacheService mock
- [ ] `createMockNeo4jService()` - Neo4jService mock
- [ ] `createMockJsonApiService()` - JsonApiService mock
- [ ] `createMockStripeClient()` - Stripe SDK mock
- [ ] `createMockFastifyReply()` - FastifyReply mock
- [ ] `createMockExecutionContext()` - NestJS ExecutionContext mock
- [ ] `createMockJob()` - BullMQ Job mock
- [ ] `MOCK_ADMIN_USER` / `MOCK_REGULAR_USER` - User fixtures
- [ ] `TEST_IDS` - Consistent UUIDs for test data

**If a mock doesn't exist, CREATE IT in the shared location before using it.**

---

## Anti-Patterns to Avoid

### DO NOT inline complex mocks

```typescript
// BAD - duplicated across tests
const mockCacheService = {
  get: vi.fn(),
  set: vi.fn(),
  del: vi.fn(),
  invalidateByType: vi.fn(),
  invalidateByElement: vi.fn(),
};

// GOOD - use factory
import { createMockCacheService } from "../../../__tests__/mocks/cache.mock";
const cacheService = createMockCacheService();
```

### DO NOT hardcode UUIDs

```typescript
// BAD - magic strings
const companyId = "550e8400-e29b-41d4-a716-446655440000";

// GOOD - use fixtures
import { TEST_IDS } from "../../../__tests__/fixtures/user.fixtures";
const companyId = TEST_IDS.companyId;
```

### DO NOT duplicate user mock objects

```typescript
// BAD - duplicated in every test file
const mockAdminUser = {
  userId: "123",
  companyId: "456",
  roles: [{ id: "admin-role-id", name: "Company Administrator" }],
  language: "en",
  isAdministrator: true,
};

// GOOD - use fixtures
import { MOCK_ADMIN_USER } from "../../../__tests__/fixtures/user.fixtures";
const request = { user: MOCK_ADMIN_USER } as AuthenticatedRequest;
```

---

## Sources

- [Ralph Wiggum - AI Loop Technique for Claude Code](https://awesomeclaude.ai/ralph-wiggum)
- [GitHub - Ralph Claude Code](https://github.com/frankbria/ralph-claude-code)
- [Ralph Wiggum: Autonomous Loops for Claude Code](https://paddo.dev/blog/ralph-wiggum-autonomous-loops/)
- [Anthropic Claude Code Ralph Wiggum Plugin](https://github.com/anthropics/claude-code/blob/main/plugins/ralph-wiggum/README.md)
