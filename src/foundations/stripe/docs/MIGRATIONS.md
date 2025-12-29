# Migration Guide - Stripe Foundation Module

Guide for migrating from the old `core/stripe` and `foundations/billing` modules to the new unified `foundations/stripe` module.

## Table of Contents

- [Overview](#overview)
- [Breaking Changes](#breaking-changes)
- [Migration Steps](#migration-steps)
- [Import Path Updates](#import-path-updates)
- [Module Registration Updates](#module-registration-updates)
- [Testing Your Migration](#testing-your-migration)
- [Rollback Steps](#rollback-steps)
- [Common Issues](#common-issues)

---

## Overview

### What Changed?

The Stripe billing functionality has been consolidated from two separate modules into a single unified module:

**Before (v1.x):**
```
packages/nestjs-neo4jsonapi/src/
├── core/stripe/                    # Stripe SDK services
│   ├── services/
│   ├── errors/
│   └── __tests__/
└── foundations/billing/            # Business logic + repositories
    ├── controllers/
    ├── services/
    ├── repositories/
    └── processors/
```

**After (v2.x):**
```
packages/nestjs-neo4jsonapi/src/
└── foundations/stripe/             # Everything unified
    ├── controllers/
    ├── services/                   # All 15 services (API + business)
    ├── repositories/
    ├── processors/
    ├── errors/
    └── __tests__/
```

### Why Consolidate?

**Problems with Old Structure:**
- ❌ Confusion: "Is this in core or foundations?"
- ❌ Circular dependency risks between core/stripe and foundations/billing
- ❌ Import path inconsistencies
- ❌ Duplicate documentation
- ❌ Difficult to understand module boundaries

**Benefits of New Structure:**
- ✅ Single import path: `@carlonicora/nestjs-neo4jsonapi/foundations/stripe`
- ✅ Clear module ownership
- ✅ Easier navigation and discovery
- ✅ Consolidated documentation
- ✅ Simpler dependency graph

---

## Breaking Changes

### 1. Import Paths Changed

**All imports have changed:**

| Old Path | New Path |
|----------|----------|
| `@carlonicora/nestjs-neo4jsonapi/core/stripe` | `@carlonicora/nestjs-neo4jsonapi/foundations/stripe` |
| `@carlonicora/nestjs-neo4jsonapi/foundations/billing` | `@carlonicora/nestjs-neo4jsonapi/foundations/stripe` |

### 2. Module Name Changed

**Module registration:**

```typescript
// BEFORE
import { BillingModule } from '@carlonicora/nestjs-neo4jsonapi/foundations/billing';

@Module({
  imports: [BillingModule],
})
export class AppModule {}
```

```typescript
// AFTER
import { StripeModule } from '@carlonicora/nestjs-neo4jsonapi/foundations/stripe';

@Module({
  imports: [StripeModule],
})
export class AppModule {}
```

### 3. Service Names Unchanged

**Service names remain the same (no breaking changes):**

```typescript
// Still works the same
import {
  BillingService,
  SubscriptionService,
  StripeCustomerService,
} from '@carlonicora/nestjs-neo4jsonapi/foundations/stripe';
```

### 4. Entity Names Unchanged

**Entity class names remain the same:**

```typescript
// Still works the same
import {
  BillingCustomer,
  BillingSubscription,
  BillingInvoice,
} from '@carlonicora/nestjs-neo4jsonapi/foundations/stripe';
```

---

## Migration Steps

### Step 1: Update Package Imports

**Automated migration with find/replace:**

#### 1.1 Update Core Stripe Imports

**Find:**
```
from '@carlonicora/nestjs-neo4jsonapi/core/stripe
```

**Replace with:**
```
from '@carlonicora/nestjs-neo4jsonapi/foundations/stripe
```

**Terminal command:**
```bash
# Find all files with old imports
rg "from.*@carlonicora/nestjs-neo4jsonapi/core/stripe" --files-with-matches

# Use sed to replace (macOS)
find . -type f -name "*.ts" -exec sed -i '' \
  's|@carlonicora/nestjs-neo4jsonapi/core/stripe|@carlonicora/nestjs-neo4jsonapi/foundations/stripe|g' {} +

# Use sed to replace (Linux)
find . -type f -name "*.ts" -exec sed -i \
  's|@carlonicora/nestjs-neo4jsonapi/core/stripe|@carlonicora/nestjs-neo4jsonapi/foundations/stripe|g' {} +
```

#### 1.2 Update Foundations Billing Imports

**Find:**
```
from '@carlonicora/nestjs-neo4jsonapi/foundations/billing
```

**Replace with:**
```
from '@carlonicora/nestjs-neo4jsonapi/foundations/stripe
```

**Terminal command:**
```bash
# Find all files with old imports
rg "from.*@carlonicora/nestjs-neo4jsonapi/foundations/billing" --files-with-matches

# Use sed to replace (macOS)
find . -type f -name "*.ts" -exec sed -i '' \
  's|@carlonicora/nestjs-neo4jsonapi/foundations/billing|@carlonicora/nestjs-neo4jsonapi/foundations/stripe|g' {} +

# Use sed to replace (Linux)
find . -type f -name "*.ts" -exec sed -i \
  's|@carlonicora/nestjs-neo4jsonapi/foundations/billing|@carlonicora/nestjs-neo4jsonapi/foundations/stripe|g' {} +
```

### Step 2: Update Module Registrations

**In your app.module.ts or feature modules:**

```typescript
// BEFORE
import { BillingModule } from '@carlonicora/nestjs-neo4jsonapi/foundations/billing';

@Module({
  imports: [
    BillingModule,
    // ... other modules
  ],
})
export class AppModule {}
```

```typescript
// AFTER
import { StripeModule } from '@carlonicora/nestjs-neo4jsonapi/foundations/stripe';

@Module({
  imports: [
    StripeModule,
    // ... other modules
  ],
})
export class AppModule {}
```

**Find all module registrations:**
```bash
rg "BillingModule" --type ts
```

**Manual changes required** - review each file and update:
1. Import statement: `BillingModule` → `StripeModule`
2. Module decorator: `imports: [BillingModule]` → `imports: [StripeModule]`

### Step 3: Update Relative Imports (if any)

**If you have internal project files importing from relative paths:**

```typescript
// BEFORE
import { BillingService } from '../../../core/stripe/services/billing.service';

// AFTER
import { BillingService } from '@carlonicora/nestjs-neo4jsonapi/foundations/stripe';
```

**Recommendation:** Always use package imports, not relative paths, for library modules.

### Step 4: Update Test Imports

**Test files may have different import patterns:**

```typescript
// BEFORE
import { createMockStripeClient } from '../../../core/stripe/__tests__/mocks/stripe.mock';
import { MOCK_CUSTOMER } from '../../../core/stripe/__tests__/fixtures/stripe.fixtures';

// AFTER
import {
  createMockStripeClient,
  MOCK_CUSTOMER,
} from '@carlonicora/nestjs-neo4jsonapi/foundations/stripe';
```

### Step 5: Verify Compilation

**Run TypeScript compilation:**
```bash
pnpm build

# Or for specific package
cd packages/nestjs-neo4jsonapi
pnpm build
```

**Fix any remaining type errors or import issues.**

### Step 6: Run Tests

**Verify all tests pass:**
```bash
pnpm test

# Or for specific tests
pnpm test -- stripe
```

### Step 7: Update Documentation References

**If you have internal documentation referencing the old paths:**
- Update code examples
- Update import snippets
- Update architecture diagrams

---

## Import Path Updates

### Complete Import Path Mapping

| Entity Type | Old Import | New Import |
|-------------|------------|------------|
| **Services** | | |
| BillingService | `foundations/billing` | `foundations/stripe` |
| SubscriptionService | `foundations/billing` | `foundations/stripe` |
| InvoiceService | `foundations/billing` | `foundations/stripe` |
| UsageService | `foundations/billing` | `foundations/stripe` |
| BillingAdminService | `foundations/billing` | `foundations/stripe` |
| NotificationService | `foundations/billing` | `foundations/stripe` |
| StripeService | `core/stripe` | `foundations/stripe` |
| StripeCustomerService | `core/stripe` | `foundations/stripe` |
| StripeSubscriptionService | `core/stripe` | `foundations/stripe` |
| StripePaymentService | `core/stripe` | `foundations/stripe` |
| StripeInvoiceService | `core/stripe` | `foundations/stripe` |
| StripeProductService | `core/stripe` | `foundations/stripe` |
| StripeUsageService | `core/stripe` | `foundations/stripe` |
| StripePortalService | `core/stripe` | `foundations/stripe` |
| StripeWebhookService | `core/stripe` | `foundations/stripe` |
| **Repositories** | | |
| BillingCustomerRepository | `foundations/billing` | `foundations/stripe` |
| SubscriptionRepository | `foundations/billing` | `foundations/stripe` |
| InvoiceRepository | `foundations/billing` | `foundations/stripe` |
| StripeProductRepository | `foundations/billing` | `foundations/stripe` |
| StripePriceRepository | `foundations/billing` | `foundations/stripe` |
| UsageRecordRepository | `foundations/billing` | `foundations/stripe` |
| WebhookEventRepository | `foundations/billing` | `foundations/stripe` |
| **Controllers** | | |
| BillingController | `foundations/billing` | `foundations/stripe` |
| BillingAdminController | `foundations/billing` | `foundations/stripe` |
| WebhookController | `foundations/billing` | `foundations/stripe` |
| **Entities** | | |
| BillingCustomer | `foundations/billing` | `foundations/stripe` |
| BillingSubscription | `foundations/billing` | `foundations/stripe` |
| BillingInvoice | `foundations/billing` | `foundations/stripe` |
| StripeProduct | `foundations/billing` | `foundations/stripe` |
| StripePrice | `foundations/billing` | `foundations/stripe` |
| BillingUsageRecord | `foundations/billing` | `foundations/stripe` |
| WebhookEvent | `foundations/billing` | `foundations/stripe` |
| **Errors** | | |
| StripeError | `core/stripe/errors` | `foundations/stripe` |
| HandleStripeErrors | `core/stripe/errors` | `foundations/stripe` |
| **Test Utilities** | | |
| createMockStripeClient | `core/stripe/__tests__` | `foundations/stripe` |
| MOCK_CUSTOMER | `core/stripe/__tests__` | `foundations/stripe` |
| MOCK_SUBSCRIPTION | `core/stripe/__tests__` | `foundations/stripe` |

---

## Module Registration Updates

### Before: Multiple Modules

```typescript
// app.module.ts
import { Module } from '@nestjs/common';
import { BillingModule } from '@carlonicora/nestjs-neo4jsonapi/foundations/billing';
import { StripeModule as CoreStripeModule } from '@carlonicora/nestjs-neo4jsonapi/core/stripe';

@Module({
  imports: [
    BillingModule,        // Business logic
    CoreStripeModule,     // Stripe API services (if imported separately)
    // ...
  ],
})
export class AppModule {}
```

### After: Single Module

```typescript
// app.module.ts
import { Module } from '@nestjs/common';
import { StripeModule } from '@carlonicora/nestjs-neo4jsonapi/foundations/stripe';

@Module({
  imports: [
    StripeModule,         // Everything included
    // ...
  ],
})
export class AppModule {}
```

**Note:** `StripeModule` now includes all services, repositories, and controllers. You don't need to import multiple modules.

---

## Testing Your Migration

### Migration Checklist

- [ ] **Step 1:** Update all `core/stripe` imports to `foundations/stripe`
- [ ] **Step 2:** Update all `foundations/billing` imports to `foundations/stripe`
- [ ] **Step 3:** Update module registration: `BillingModule` → `StripeModule`
- [ ] **Step 4:** Search for remaining old paths: `rg "core/stripe|foundations/billing" --type ts`
- [ ] **Step 5:** Run `pnpm build` - verify no TypeScript errors
- [ ] **Step 6:** Run `pnpm lint` - verify no linting errors
- [ ] **Step 7:** Run `pnpm test` - verify all tests pass
- [ ] **Step 8:** Test in development environment
- [ ] **Step 9:** Verify webhooks still process correctly
- [ ] **Step 10:** Verify API endpoints still work

### Verification Commands

**1. Check for old import paths:**
```bash
# Should return ZERO results
rg "from.*@carlonicora/nestjs-neo4jsonapi/core/stripe" apps/
rg "from.*@carlonicora/nestjs-neo4jsonapi/foundations/billing" apps/

# Check specific directories
rg "core/stripe|foundations/billing" apps/api/src/ --type ts
```

**2. Verify build succeeds:**
```bash
pnpm clean
pnpm build

# Check for errors
echo $?  # Should output: 0 (success)
```

**3. Verify tests pass:**
```bash
pnpm test

# Check test count
# Should be 1,543+ tests passing
```

**4. Test webhook processing:**
```bash
# Start your application
pnpm start:dev

# In another terminal, use Stripe CLI
stripe listen --forward-to localhost:3000/billing/webhooks/stripe

# Trigger test event
stripe trigger customer.created
```

---

## Rollback Steps

### If Migration Fails

**Option 1: Git Revert (Recommended)**

```bash
# View recent commits
git log --oneline -5

# Revert to commit before migration
git revert <commit-hash>

# Or reset to specific commit
git reset --hard <commit-hash>
```

**Option 2: Manual Rollback**

1. **Restore old imports:**
   ```bash
   # Reverse the find/replace
   find . -type f -name "*.ts" -exec sed -i '' \
     's|@carlonicora/nestjs-neo4jsonapi/foundations/stripe|@carlonicora/nestjs-neo4jsonapi/core/stripe|g' {} +
   ```

2. **Restore module registration:**
   ```typescript
   import { BillingModule } from '@carlonicora/nestjs-neo4jsonapi/foundations/billing';

   @Module({
     imports: [BillingModule],
   })
   ```

3. **Rebuild:**
   ```bash
   pnpm clean
   pnpm install
   pnpm build
   ```

**Option 3: Use Old Package Version**

```bash
# In package.json
{
  "dependencies": {
    "@carlonicora/nestjs-neo4jsonapi": "1.x.x"  // Use old version
  }
}

pnpm install
```

---

## Common Issues

### Issue 1: "Cannot find module"

**Error:**
```
Error: Cannot find module '@carlonicora/nestjs-neo4jsonapi/foundations/billing'
```

**Cause:** Old import path not updated

**Fix:**
```typescript
// Change this:
import { BillingService } from '@carlonicora/nestjs-neo4jsonapi/foundations/billing';

// To this:
import { BillingService } from '@carlonicora/nestjs-neo4jsonapi/foundations/stripe';
```

### Issue 2: "Module not found in the current context"

**Error:**
```
Nest can't resolve dependencies of the BillingService
```

**Cause:** `BillingModule` not updated to `StripeModule`

**Fix:**
```typescript
// In app.module.ts
import { StripeModule } from '@carlonicora/nestjs-neo4jsonapi/foundations/stripe';

@Module({
  imports: [StripeModule], // Changed from BillingModule
})
```

### Issue 3: Test imports fail

**Error:**
```
Cannot find module '../core/stripe/__tests__/mocks/stripe.mock'
```

**Cause:** Test files using relative imports

**Fix:**
```typescript
// Change this:
import { createMockStripeClient } from '../../../core/stripe/__tests__/mocks/stripe.mock';

// To this:
import { createMockStripeClient } from '@carlonicora/nestjs-neo4jsonapi/foundations/stripe';
```

### Issue 4: Circular dependency warnings

**Error:**
```
Warning: Circular dependency detected
```

**Cause:** Multiple imports from different paths for same module

**Fix:** Ensure ALL imports use the new path consistently:
```bash
# Find any remaining old imports
rg "core/stripe|foundations/billing" apps/ --type ts

# Update them to foundations/stripe
```

### Issue 5: Webhook processing stops working

**Symptom:** Webhooks return 200 but don't process

**Cause:** `WebhookProcessor` not registered correctly

**Fix:** Verify `StripeModule` is imported in your app module:
```typescript
@Module({
  imports: [
    StripeModule, // ✅ This registers WebhookProcessor
  ],
})
export class AppModule {}
```

### Issue 6: Old barrel exports cached

**Error:**
```
Module '"@carlonicora/nestjs-neo4jsonapi/foundations/stripe"' has no exported member 'BillingService'
```

**Cause:** TypeScript or build cache outdated

**Fix:**
```bash
# Clear all caches
rm -rf node_modules/.cache
rm -rf dist
rm -rf packages/*/dist

# Reinstall and rebuild
pnpm clean
pnpm install
pnpm build
```

---

## Migration Support

### Getting Help

If you encounter issues during migration:

1. **Check this guide** for common issues and solutions
2. **Search existing issues** on GitHub
3. **Create a new issue** with:
   - Migration step where you got stuck
   - Full error message
   - Your package.json version
   - Output of `pnpm list @carlonicora/nestjs-neo4jsonapi`

### Useful Debug Commands

```bash
# Check installed package version
pnpm list @carlonicora/nestjs-neo4jsonapi

# Check for multiple versions (shouldn't happen)
pnpm why @carlonicora/nestjs-neo4jsonapi

# Find all import statements
rg "from.*@carlonicora/nestjs-neo4jsonapi" apps/ --type ts

# Check TypeScript compilation errors only
pnpm tsc --noEmit

# Verify no old paths remain
rg "core/stripe|foundations/billing" apps/api/src/ --type ts | wc -l
# Should output: 0
```

---

## Summary

**Migration complexity:** LOW
**Estimated time:** 15-30 minutes
**Breaking changes:** Import paths + module name only
**Code changes required:** None (just imports)

The migration is mostly a find/replace operation. Service names, entity names, and method signatures remain unchanged, so your business logic doesn't need any modifications.

**Next Steps:**
1. Follow the [Migration Steps](#migration-steps)
2. Complete the [Migration Checklist](#migration-checklist)
3. Test thoroughly in development before deploying

---

## See Also

- [Main README](../README.md) - Module overview
- [Architecture Guide](ARCHITECTURE.md) - System architecture
- [API Reference](API.md) - Complete API documentation
- [Testing Guide](TESTING.md) - Testing patterns
