# Test Coverage Gaps - nestjs-neo4jsonapi

This document lists all testable files that do not yet have associated test files.

---

## Services

### Agent Services

- [x] `src/agents/community.detector/services/community.detector.service.ts`
- [x] `src/agents/community.summariser/services/community.summariser.service.ts`
- [x] `src/agents/contextualiser/services/contextualiser.service.ts`
- [ ] `src/agents/drift/services/drift.migration.service.ts`
- [ ] `src/agents/drift/services/drift.search.service.ts`
- [ ] `src/agents/graph.creator/services/graph.creator.service.ts`
- [ ] `src/agents/responder/services/responder.service.ts`
- [ ] `src/agents/summariser/services/summariser.service.ts`

### Auth Services

- [ ] `src/foundations/auth/services/auth.discord.service.ts`
- [ ] `src/foundations/auth/services/auth.google.service.ts`
- [ ] `src/foundations/auth/services/auth.service.ts`
- [ ] `src/foundations/auth/services/pending-registration.service.ts`
- [ ] `src/foundations/auth/services/trial-queue.service.ts`

### Chunker Services

- [ ] `src/foundations/chunker/services/chunker.service.ts`

### Foundation Services

- [ ] `src/foundations/atomicfact/services/atomicfact.service.ts`
- [ ] `src/foundations/audit/services/audit.service.ts`
- [ ] `src/foundations/chunk/services/chunk.service.ts`
- [ ] `src/foundations/community/services/community.service.ts`
- [ ] `src/foundations/content/services/content.service.ts`
- [ ] `src/foundations/content/services/content.cypher.service.ts`
- [ ] `src/foundations/discord-user/services/discord-user.service.ts`
- [ ] `src/foundations/discord/services/discord.service.ts`
- [ ] `src/foundations/feature/services/feature.service.ts`
- [ ] `src/foundations/google-user/services/google-user.service.ts`
- [ ] `src/foundations/keyconcept/services/keyconcept.service.ts`
- [ ] `src/foundations/notification/services/notification.service.ts`
- [ ] `src/foundations/push/services/push.service.ts`
- [ ] `src/foundations/relevancy/services/relevancy.service.ts`
- [ ] `src/foundations/role/services/role.service.ts`
- [ ] `src/foundations/s3/services/s3.service.ts`
- [ ] `src/foundations/tokenusage/services/tokenusage.service.ts`
- [ ] `src/foundations/user/services/user.service.ts`
- [ ] `src/foundations/user/services/user.cypher.service.ts`

### Stripe Services

- [ ] `src/foundations/stripe-customer/services/stripe-customer-admin.service.ts`
- [ ] `src/foundations/stripe-trial/services/trial.service.ts`

---

## Repositories

- [ ] `src/core/neo4j/abstracts/abstract.repository.ts`
- [ ] `src/foundations/atomicfact/repositories/atomicfact.repository.ts`
- [ ] `src/foundations/audit/repositories/audit.repository.ts`
- [ ] `src/foundations/auth/repositories/auth.repository.ts`
- [ ] `src/foundations/chunk/repositories/chunk.repository.ts`
- [ ] `src/foundations/community/repositories/community.repository.ts`
- [ ] `src/foundations/content/repositories/content.repository.ts`
- [ ] `src/foundations/discord-user/repositories/discord-user.repository.ts`
- [ ] `src/foundations/feature/repositories/feature.repository.ts`
- [ ] `src/foundations/google-user/repositories/google-user.repository.ts`
- [ ] `src/foundations/keyconcept/repositories/keyconcept.repository.ts`
- [ ] `src/foundations/module/repositories/module.repository.ts`
- [ ] `src/foundations/notification/repositories/notification.repository.ts`
- [ ] `src/foundations/oauth/repositories/oauth.repository.ts`
- [ ] `src/foundations/push/repositories/push.repository.ts`
- [ ] `src/foundations/relevancy/repositories/relevancy.repository.ts`
- [ ] `src/foundations/role/repositories/role.repository.ts`
- [ ] `src/foundations/tokenusage/repositories/tokenusage.repository.ts`

---

## Guards

- [ ] `src/common/guards/jwt.auth.admin.guard.ts`
- [ ] `src/common/guards/jwt.auth.guard.ts`
- [ ] `src/common/guards/jwt.auth.optional.guard.ts`
- [ ] `src/common/guards/jwt.or.oauth.guard.ts`
- [ ] `src/core/websocket/guards/ws.jwt.auth.guard.ts`
- [ ] `src/foundations/oauth/guards/oauth.token.guard.ts`

---

## Interceptors

- [ ] `src/core/cache/interceptors/cache.interceptor.ts`
- [ ] `src/core/logging/interceptors/logging.interceptor.ts`
- [ ] `src/core/tracing/interceptors/tracing.interceptor.ts`

---

## Processors

- [ ] `src/agents/community.summariser/processors/community.summariser.processor.ts`
- [ ] `src/foundations/chunk/processors/chunk.processor.ts`
- [ ] `src/foundations/company/processors/company.processor.ts`
- [ ] `src/foundations/stripe-trial/processors/trial.processor.ts`

---

## Serialisers

- [ ] `src/core/jsonapi/abstracts/abstract.jsonapi.serialiser.ts`
- [ ] `src/core/jsonapi/serialisers/descriptor.based.serialiser.ts`
- [ ] `src/foundations/audit/serialisers/audit.serialiser.ts`
- [ ] `src/foundations/auth/serialisers/auth.serialiser.ts`
- [ ] `src/foundations/chunk/serialisers/chunk.serialiser.ts`
- [ ] `src/foundations/content/serialisers/content.serialiser.ts`
- [ ] `src/foundations/discord/serialisers/discord.error.serialiser.ts`
- [ ] `src/foundations/feature/serialisers/feature.serialiser.ts`
- [ ] `src/foundations/module/serialisers/module.serialiser.ts`
- [ ] `src/foundations/notification/serialisers/notifications.serialiser.ts`
- [ ] `src/foundations/oauth/serialisers/oauth.client.serialiser.ts`
- [ ] `src/foundations/oauth/serialisers/oauth.token.serialiser.ts`
- [ ] `src/foundations/s3/serialisers/s3.serialiser.ts`
- [ ] `src/foundations/stripe-customer/serialisers/stripe-customer.serialiser.ts`
- [ ] `src/foundations/stripe-customer/serialisers/stripe-payment-method.serialiser.ts`
- [ ] `src/foundations/stripe-invoice/serialisers/stripe-invoice.serialiser.ts`
- [ ] `src/foundations/stripe-price/serialisers/stripe-price.serialiser.ts`
- [ ] `src/foundations/stripe-product/serialisers/stripe-product.serialiser.ts`
- [ ] `src/foundations/stripe-subscription/serialisers/stripe-subscription.serialiser.ts`
- [ ] `src/foundations/stripe-usage/serialisers/stripe-usage-record.serialiser.ts`
- [ ] `src/foundations/stripe-webhook/serialisers/stripe-webhook-event.serialiser.ts`

---

## Decorators

- [ ] `src/common/decorators/conditional-service.decorator.ts`
- [ ] `src/common/decorators/module.decorator.ts`
- [ ] `src/common/decorators/oauth.scopes.decorator.ts`
- [ ] `src/common/decorators/rate-limit.decorator.ts`
- [ ] `src/common/decorators/roles.decorator.ts`
- [ ] `src/common/decorators/tool.decorator.ts`

---

## Factories

- [ ] `src/agents/contextualiser/factories/contextualiser.context.factory.ts`
- [ ] `src/agents/responder/factories/responder.context.factory.ts`
- [ ] `src/core/jsonapi/factories/dynamic.relationship.factory.ts`
- [ ] `src/core/jsonapi/factories/jsonapi.serialiser.factory.ts`
- [ ] `src/core/neo4j/factories/entity.factory.ts`
- [ ] `src/foundations/content/factories/content.model.factory.ts`

---

## Strategies

- [ ] `src/common/strategies/jwt.strategy.ts`

---

## Utilities

- [ ] `src/core/llm/utils/tools.utils.ts`
- [ ] `src/core/llm/utils/schema.utils.ts`

---

## Abstracts

- [ ] `src/core/neo4j/abstracts/abstract.service.ts`
- [ ] `src/core/llm/abstracts/abstract.tools.ts`

---

## DTOs

### Auth DTOs

- [ ] `src/foundations/auth/dtos/auth.post.forgot.dto.ts`
- [ ] `src/foundations/auth/dtos/auth.post.login.dto.ts`
- [ ] `src/foundations/auth/dtos/auth.post.register.dto.ts`
- [ ] `src/foundations/auth/dtos/auth.post.resetpassword.dto.ts`

### Content DTOs

- [ ] `src/foundations/content/dtos/content.dto.ts`

### Feature DTOs

- [ ] `src/foundations/feature/dtos/feature.dto.ts`

### Module DTOs

- [ ] `src/foundations/module/dtos/module.dto.ts`

### Notification DTOs

- [ ] `src/foundations/notification/dtos/notification.patch.dto.ts`

### OAuth DTOs

- [ ] `src/foundations/oauth/dtos/oauth.authorize.dto.ts`
- [ ] `src/foundations/oauth/dtos/oauth.client.dto.ts`
- [ ] `src/foundations/oauth/dtos/oauth.introspect.dto.ts`
- [ ] `src/foundations/oauth/dtos/oauth.revoke.dto.ts`
- [ ] `src/foundations/oauth/dtos/oauth.token.dto.ts`

### Push DTOs

- [ ] `src/foundations/push/dtos/subscription.push.dto.ts`

### Role DTOs

- [ ] `src/foundations/role/dtos/role.dto.ts`
- [ ] `src/foundations/role/dtos/role.post.dto.ts`

### User DTOs

- [ ] `src/foundations/user/dtos/user.dto.ts`
- [ ] `src/foundations/user/dtos/user.patch.rate.dto.ts`
- [ ] `src/foundations/user/dtos/user.post.dto.ts`
- [ ] `src/foundations/user/dtos/user.put.dto.ts`

### Stripe DTOs

- [ ] `src/foundations/stripe/dtos/create-setup-intent.dto.ts`
- [ ] `src/foundations/stripe-usage/dtos/stripe-usage.dto.ts`
- [ ] `src/foundations/stripe-subscription/dtos/stripe-subscription.dto.ts`
- [ ] `src/foundations/stripe-product/dtos/stripe-product.dto.ts`

### Company DTOs

- [ ] `src/foundations/company/dtos/company.configurations.put.dto.ts`
- [ ] `src/foundations/company/dtos/company.dto.ts`
- [ ] `src/foundations/company/dtos/company.post.dto.ts`
- [ ] `src/foundations/company/dtos/company.put.dto.ts`

---

## Entities/Models

- [ ] `src/foundations/atomicfact/entities/atomic.fact.entity.ts`
- [ ] `src/foundations/audit/entities/audit.entity.ts`
- [ ] `src/foundations/auth/entities/auth.code.entity.ts`
- [ ] `src/foundations/auth/entities/auth.entity.ts`
- [ ] `src/foundations/chunk/entities/chunk.entity.ts`
- [ ] `src/foundations/community/entities/community.entity.ts`
- [ ] `src/foundations/content/entities/content.entity.ts`
- [ ] `src/foundations/feature/entities/feature.entity.ts`
- [ ] `src/foundations/keyconcept/entities/key.concept.entity.ts`
- [ ] `src/foundations/module/entities/module.entity.ts`
- [ ] `src/foundations/notification/entities/notification.entity.ts`
- [ ] `src/foundations/oauth/entities/oauth.access.token.entity.ts`
- [ ] `src/foundations/oauth/entities/oauth.authorization.code.entity.ts`
- [ ] `src/foundations/oauth/entities/oauth.client.entity.ts`
- [ ] `src/foundations/oauth/entities/oauth.refresh.token.entity.ts`
- [ ] `src/foundations/push/entities/push.entity.ts`
- [ ] `src/foundations/s3/entities/s3.entity.ts`
- [ ] `src/foundations/tokenusage/entities/tokenusage.entity.ts`
- [ ] `src/foundations/stripe-customer/entities/stripe-customer.entity.ts`
- [ ] `src/foundations/stripe-customer/entities/stripe-payment-method.entity.ts`
- [ ] `src/foundations/stripe-invoice/entities/stripe-invoice.entity.ts`
- [ ] `src/foundations/stripe-price/entities/stripe-price.entity.ts`
- [ ] `src/foundations/stripe-product/entities/stripe-product.entity.ts`
- [ ] `src/foundations/stripe-subscription/entities/stripe-subscription.entity.ts`
- [ ] `src/foundations/stripe-usage/entities/stripe-usage-record.entity.ts`
- [ ] `src/foundations/stripe-webhook/entities/stripe-webhook-event.entity.ts`

---

## Modules

- [ ] `src/agents/community.detector/community.detector.module.ts`
- [ ] `src/agents/community.summariser/community.summariser.module.ts`
- [ ] `src/agents/contextualiser/contextualiser.module.ts`
- [ ] `src/agents/drift/drift.module.ts`
- [ ] `src/agents/graph.creator/graph.creator.module.ts`
- [ ] `src/agents/responder/responder.module.ts`
- [ ] `src/agents/summariser/summariser.module.ts`
- [ ] `src/core/appmode/app.mode.module.ts`
- [ ] `src/core/blocknote/blocknote.module.ts`
- [ ] `src/core/cache/cache.module.ts`
- [ ] `src/core/cors/cors.module.ts`
- [ ] `src/core/debug/debug.module.ts`
- [ ] `src/core/email/email.module.ts`
- [ ] `src/core/jsonapi/jsonapi.module.ts`
- [ ] `src/core/llm/llm.module.ts`
- [ ] `src/core/logging/logging.module.ts`
- [ ] `src/core/migrator/migrator.module.ts`
- [ ] `src/core/neo4j/neo4j.module.ts`
- [ ] `src/core/redis/redis.module.ts`
- [ ] `src/core/security/security.module.ts`
- [ ] `src/core/tracing/tracing.module.ts`
- [ ] `src/core/version/version.module.ts`
- [ ] `src/core/websocket/websocket.module.ts`
- [ ] `src/core/health/health.module.ts`
- [ ] `src/core/queue/queue.module.ts`
- [ ] `src/foundations/atomicfact/atomicfact.module.ts`
- [ ] `src/foundations/audit/audit.module.ts`
- [ ] `src/foundations/auth/auth.module.ts`
- [ ] `src/foundations/chunk/chunk.module.ts`
- [ ] `src/foundations/chunker/chunker.module.ts`
- [ ] `src/foundations/community/community.module.ts`
- [ ] `src/foundations/content/content.module.ts`
- [ ] `src/foundations/discord-user/discord-user.module.ts`
- [ ] `src/foundations/discord/discord.module.ts`
- [ ] `src/foundations/feature/feature.module.ts`
- [ ] `src/foundations/google-user/google-user.module.ts`
- [ ] `src/foundations/keyconcept/keyconcept.module.ts`
- [ ] `src/foundations/module/module.module.ts`
- [ ] `src/foundations/notification/notification.module.ts`
- [ ] `src/foundations/oauth/oauth.module.ts`
- [ ] `src/foundations/push/push.module.ts`
- [ ] `src/foundations/relevancy/relevancy.module.ts`
- [ ] `src/foundations/role/role.module.ts`
- [ ] `src/foundations/s3/s3.module.ts`
- [ ] `src/foundations/tokenusage/tokenusage.module.ts`
- [ ] `src/foundations/company/company.module.ts`
- [ ] `src/foundations/user/user.module.ts`
- [ ] `src/foundations/stripe/stripe.module.ts`
- [ ] `src/foundations/stripe-customer/stripe-customer.module.ts`
- [ ] `src/foundations/stripe-invoice/stripe-invoice.module.ts`
- [ ] `src/foundations/stripe-price/stripe-price.module.ts`
- [ ] `src/foundations/stripe-product/stripe-product.module.ts`
- [ ] `src/foundations/stripe-subscription/stripe-subscription.module.ts`
- [ ] `src/foundations/stripe-trial/stripe-trial.module.ts`
- [ ] `src/foundations/stripe-usage/stripe-usage.module.ts`
- [ ] `src/foundations/stripe-webhook/stripe-webhook.module.ts`
