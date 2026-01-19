# Test Coverage Gaps - nestjs-neo4jsonapi

This document lists all testable files that do not yet have associated test files.

**Total Files Needing Tests:** ~250+ files
**Current Test Coverage:** ~9%

---

## Controllers (26 files)

- [x] `src/core/health/controllers/health.controller.ts`
- [x] `src/core/version/controllers/version.controller.ts`
- [x] `src/foundations/audit/controllers/audit.controller.ts`
- [x] `src/foundations/auth/controllers/auth.controller.ts`
- [x] `src/foundations/auth/controllers/auth.discord.controller.ts`
- [x] `src/foundations/auth/controllers/auth.google.controller.ts`
- [x] `src/foundations/chunk/controllers/chunk.controller.ts`
- [x] `src/foundations/content/controllers/content.controller.ts`
- [x] `src/foundations/feature/controllers/feature.controller.ts`
- [x] `src/foundations/notification/controllers/notification.controller.ts`
- [x] `src/foundations/oauth/controllers/oauth.authorize.controller.ts`
- [x] `src/foundations/oauth/controllers/oauth.management.controller.ts`
- [x] `src/foundations/oauth/controllers/oauth.token.controller.ts`
- [x] `src/foundations/push/controllers/push.controller.ts`
- [x] `src/foundations/role/controllers/role.controller.ts`
- [x] `src/foundations/role/controllers/role.user.controller.ts`
- [x] `src/foundations/s3/controllers/s3.controller.ts`
- [x] `src/foundations/stripe-customer/controllers/stripe-customer.controller.ts`
- [x] `src/foundations/stripe-invoice/controllers/stripe-invoice.controller.ts`
- [x] `src/foundations/stripe-usage/controllers/stripe-usage.controller.ts`
- [x] `src/foundations/user/controllers/user.controller.ts`

---

## Services (92 files)

### Core Services

- [x] `src/core/cache/services/cache.service.ts`
- [ ] `src/core/cors/services/cors.options.service.ts`
- [ ] `src/core/debug/services/debug.module.service.ts`
- [ ] `src/core/email/services/email.service.ts`
- [ ] `src/core/jsonapi/services/jsonapi.deserialiser.service.ts`
- [ ] `src/core/jsonapi/services/jsonapi.query.service.ts`
- [ ] `src/core/jsonapi/services/jsonapi.registry.service.ts`
- [ ] `src/core/jsonapi/services/jsonapi.relationship.service.ts`
- [ ] `src/core/jsonapi/services/jsonapi.service.ts`
- [ ] `src/core/llm/services/llm.service.ts`
- [ ] `src/core/llm/services/streaming.service.ts`
- [ ] `src/core/logging/services/logging.service.ts`
- [ ] `src/core/migrator/services/migrator.service.ts`
- [ ] `src/core/neo4j/services/neo4j.service.ts`
- [ ] `src/core/redis/services/redis.service.ts`
- [ ] `src/core/security/services/security.service.ts`
- [ ] `src/core/tracing/services/tracing.service.ts`
- [ ] `src/core/version/services/version.service.ts`
- [ ] `src/core/websocket/services/ws.context.service.ts`
- [ ] `src/core/websocket/services/ws.gateway.base.ts`
- [ ] `src/core/websocket/services/ws.registry.service.ts`

### Agent Services

- [ ] `src/agents/community.detector/services/community.detector.agent.service.ts`
- [ ] `src/agents/community.summariser/services/community.summariser.agent.service.ts`
- [ ] `src/agents/community.summariser/services/community.summariser.service.ts`
- [ ] `src/agents/contextualiser/services/contextualiser.agent.service.ts`
- [ ] `src/agents/contextualiser/services/contextualiser.output.service.ts`
- [ ] `src/agents/contextualiser/services/contextualiser.service.ts`
- [ ] `src/agents/contextualiser.nodes/services/contextualiser.nodes.agent.service.ts`
- [ ] `src/agents/contextualiser.nodes/services/contextualiser.nodes.service.ts`
- [ ] `src/agents/drift/services/drift.agent.service.ts`
- [ ] `src/agents/drift/services/drift.service.ts`
- [ ] `src/agents/drift.nodes/services/drift.nodes.agent.service.ts`
- [ ] `src/agents/drift.nodes/services/drift.nodes.service.ts`
- [ ] `src/agents/graph.creator/services/graph.creator.agent.service.ts`
- [ ] `src/agents/graph.creator/services/graph.creator.service.ts`
- [ ] `src/agents/responder/services/responder.agent.service.ts`
- [ ] `src/agents/responder/services/responder.output.service.ts`
- [ ] `src/agents/responder/services/responder.service.ts`
- [ ] `src/agents/summariser/services/summariser.agent.service.ts`
- [ ] `src/agents/summariser/services/summariser.output.service.ts`
- [ ] `src/agents/summariser/services/summariser.service.ts`

### Auth Services

- [ ] `src/foundations/auth/services/auth.discord.service.ts`
- [ ] `src/foundations/auth/services/auth.google.service.ts`
- [ ] `src/foundations/auth/services/auth.service.ts`
- [ ] `src/foundations/auth/services/pending-registration.service.ts`
- [ ] `src/foundations/auth/services/trial-queue.service.ts`

### Chunker Services

- [ ] `src/foundations/chunker/services/chunker.docx.service.ts`
- [ ] `src/foundations/chunker/services/chunker.imageextractor.service.ts`
- [ ] `src/foundations/chunker/services/chunker.pdf.service.ts`
- [ ] `src/foundations/chunker/services/chunker.pptx.service.ts`
- [ ] `src/foundations/chunker/services/chunker.semanticsplitter.service.ts`
- [ ] `src/foundations/chunker/services/chunker.service.ts`
- [ ] `src/foundations/chunker/services/chunker.xlsx.service.ts`

### Foundation Services

- [ ] `src/foundations/atomicfact/services/atomicfact.service.ts`
- [ ] `src/foundations/audit/services/audit.service.ts`
- [ ] `src/foundations/chunk/services/chunk.service.ts`
- [ ] `src/foundations/community/services/community.service.ts`
- [ ] `src/foundations/content/services/content.processing.service.ts`
- [ ] `src/foundations/content/services/content.service.ts`
- [ ] `src/foundations/discord-user/services/discord-user.service.ts`
- [ ] `src/foundations/discord/services/discord.service.ts`
- [ ] `src/foundations/feature/services/feature.service.ts`
- [ ] `src/foundations/google-user/services/google-user.service.ts`
- [ ] `src/foundations/keyconcept/services/keyconcept.service.ts`
- [ ] `src/foundations/module/services/module.service.ts`
- [ ] `src/foundations/notification/services/notification.service.ts`
- [ ] `src/foundations/push/services/push.service.ts`
- [ ] `src/foundations/relevancy/services/relevancy.service.ts`
- [ ] `src/foundations/role/services/role.service.ts`
- [ ] `src/foundations/s3/services/s3.service.ts`
- [ ] `src/foundations/tokenusage/services/tokenusage.service.ts`
- [ ] `src/foundations/user/services/user.service.ts`

### Stripe Services

- [ ] `src/foundations/stripe-customer/services/stripe-customer-admin.service.ts`
- [ ] `src/foundations/stripe-invoice/services/stripe-invoice-sync.service.ts`
- [ ] `src/foundations/stripe-price/services/stripe-price-api.service.ts`
- [ ] `src/foundations/stripe-price/services/stripe-price-sync.service.ts`
- [ ] `src/foundations/stripe-product/services/stripe-product-sync.service.ts`
- [ ] `src/foundations/stripe-subscription/services/stripe-subscription-sync.service.ts`
- [ ] `src/foundations/stripe-trial/services/stripe-trial.service.ts`
- [ ] `src/foundations/stripe-usage/services/stripe-usage-sync.service.ts`
- [ ] `src/foundations/stripe/services/stripe.service.ts`

---

## Repositories (26 files)

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

---

## Guards (6 files)

- [ ] `src/common/guards/jwt.auth.admin.guard.ts`
- [ ] `src/common/guards/jwt.auth.guard.ts`
- [ ] `src/common/guards/jwt.auth.optional.guard.ts`
- [ ] `src/common/guards/jwt.or.oauth.guard.ts`
- [ ] `src/core/websocket/guards/ws.jwt.auth.guard.ts`
- [ ] `src/foundations/oauth/guards/oauth.token.guard.ts`

---

## Interceptors (3 files)

- [ ] `src/core/cache/interceptors/cache.interceptor.ts`
- [ ] `src/core/logging/interceptors/logging.interceptor.ts`
- [ ] `src/core/tracing/interceptors/tracing.interceptor.ts`

---

## Filters (1 file)

- [ ] `src/common/filters/http-exception.filter.ts`

---

## Processors (5 files)

- [ ] `src/agents/community.summariser/processors/community.summariser.processor.ts`
- [ ] `src/foundations/chunk/processors/chunk.processor.ts`
- [ ] `src/foundations/company/processors/company.processor.ts`
- [ ] `src/foundations/stripe-trial/processors/trial.processor.ts`
- [ ] `src/foundations/stripe-webhook/processors/stripe-webhook.processor.ts`

---

## Serialisers (21 files)

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

## Decorators (6 files)

- [ ] `src/common/decorators/conditional-service.decorator.ts`
- [ ] `src/common/decorators/module.decorator.ts`
- [ ] `src/common/decorators/oauth.scopes.decorator.ts`
- [ ] `src/common/decorators/rate-limit.decorator.ts`
- [ ] `src/common/decorators/roles.decorator.ts`
- [ ] `src/common/decorators/tool.decorator.ts`

---

## Factories (7 files)

- [ ] `src/agents/contextualiser/factories/contextualiser.context.factory.ts`
- [ ] `src/agents/responder/factories/responder.context.factory.ts`
- [ ] `src/bootstrap/app.module.factory.ts`
- [ ] `src/core/jsonapi/factories/dynamic.relationship.factory.ts`
- [ ] `src/core/jsonapi/factories/jsonapi.serialiser.factory.ts`
- [ ] `src/core/neo4j/factories/entity.factory.ts`
- [ ] `src/foundations/content/factories/content.model.factory.ts`

---

## Strategies (5 files)

- [ ] `src/common/strategies/jwt.strategy.ts`
- [ ] `src/foundations/auth/strategies/discord.strategy.ts`
- [ ] `src/foundations/auth/strategies/google.strategy.ts`
- [ ] `src/foundations/oauth/strategies/oauth.strategy.ts`
- [ ] `src/foundations/oauth/strategies/oauth.token.strategy.ts`

---

## Utilities (15+ files)

- [ ] `src/common/utils/env.utils.ts`
- [ ] `src/common/utils/ip.utils.ts`
- [ ] `src/common/utils/pagination.utils.ts`
- [ ] `src/common/utils/query.utils.ts`
- [ ] `src/common/utils/string.utils.ts`
- [ ] `src/common/utils/validation.utils.ts`
- [ ] `src/core/jsonapi/utils/sparse-fields.utils.ts`
- [ ] `src/core/neo4j/utils/cypher.utils.ts`
- [ ] `src/core/neo4j/utils/relationship.utils.ts`
- [ ] `src/core/websocket/utils/ws.utils.ts`
- [ ] `src/foundations/auth/utils/auth.utils.ts`
- [ ] `src/foundations/oauth/utils/oauth.crypto.utils.ts`
- [ ] `src/foundations/oauth/utils/oauth.scope.utils.ts`
- [ ] `src/foundations/stripe/utils/stripe.utils.ts`

---

## DTOs (30+ files)

### Auth DTOs
- [ ] `src/foundations/auth/dtos/auth.dto.ts`
- [ ] `src/foundations/auth/dtos/pending-registration.dto.ts`

### Chunk DTOs
- [ ] `src/foundations/chunk/dtos/chunk.dto.ts`

### Content DTOs
- [ ] `src/foundations/content/dtos/content.dto.ts`

### Feature DTOs
- [ ] `src/foundations/feature/dtos/feature.dto.ts`

### Notification DTOs
- [ ] `src/foundations/notification/dtos/notification.dto.ts`

### OAuth DTOs
- [ ] `src/foundations/oauth/dtos/oauth.authorize.dto.ts`
- [ ] `src/foundations/oauth/dtos/oauth.client.dto.ts`
- [ ] `src/foundations/oauth/dtos/oauth.token.dto.ts`

### Push DTOs
- [ ] `src/foundations/push/dtos/push.dto.ts`

### Role DTOs
- [ ] `src/foundations/role/dtos/role.dto.ts`

### S3 DTOs
- [ ] `src/foundations/s3/dtos/s3.dto.ts`

### User DTOs
- [ ] `src/foundations/user/dtos/user.dto.ts`

---

## Entities/Models (25+ files)

- [ ] `src/foundations/atomicfact/entities/atomicfact.entity.ts`
- [ ] `src/foundations/audit/entities/audit.entity.ts`
- [ ] `src/foundations/auth/entities/pending-registration.entity.ts`
- [ ] `src/foundations/chunk/entities/chunk.entity.ts`
- [ ] `src/foundations/community/entities/community.entity.ts`
- [ ] `src/foundations/content/entities/content.entity.ts`
- [ ] `src/foundations/discord-user/entities/discord-user.entity.ts`
- [ ] `src/foundations/feature/entities/feature.entity.ts`
- [ ] `src/foundations/google-user/entities/google-user.entity.ts`
- [ ] `src/foundations/keyconcept/entities/keyconcept.entity.ts`
- [ ] `src/foundations/module/entities/module.entity.ts`
- [ ] `src/foundations/notification/entities/notification.entity.ts`
- [ ] `src/foundations/oauth/entities/oauth.client.entity.ts`
- [ ] `src/foundations/oauth/entities/oauth.token.entity.ts`
- [ ] `src/foundations/push/entities/push.entity.ts`
- [ ] `src/foundations/relevancy/entities/relevancy.entity.ts`
- [ ] `src/foundations/role/entities/role.entity.ts`
- [ ] `src/foundations/tokenusage/entities/tokenusage.entity.ts`
- [ ] `src/foundations/user/entities/user.entity.ts`

---

## Modules (20+ files)

- [ ] `src/agents/community.detector/community.detector.module.ts`
- [ ] `src/agents/community.summariser/community.summariser.module.ts`
- [ ] `src/agents/contextualiser/contextualiser.module.ts`
- [ ] `src/agents/contextualiser.nodes/contextualiser.nodes.module.ts`
- [ ] `src/agents/drift/drift.module.ts`
- [ ] `src/agents/drift.nodes/drift.nodes.module.ts`
- [ ] `src/agents/graph.creator/graph.creator.module.ts`
- [ ] `src/agents/responder/responder.module.ts`
- [ ] `src/agents/summariser/summariser.module.ts`
- [ ] `src/core/cache/cache.module.ts`
- [ ] `src/core/cors/cors.module.ts`
- [ ] `src/core/email/email.module.ts`
- [ ] `src/core/jsonapi/jsonapi.module.ts`
- [ ] `src/core/llm/llm.module.ts`
- [ ] `src/core/logging/logging.module.ts`
- [ ] `src/core/migrator/migrator.module.ts`
- [ ] `src/core/neo4j/neo4j.module.ts`
- [ ] `src/core/redis/redis.module.ts`
- [ ] `src/core/security/security.module.ts`
- [ ] `src/core/tracing/tracing.module.ts`
- [ ] `src/core/websocket/websocket.module.ts`

---

## Health Indicators (4 files)

- [ ] `src/core/health/indicators/disk.health.ts`
- [ ] `src/core/health/indicators/neo4j.health.ts`
- [ ] `src/core/health/indicators/redis.health.ts`
- [ ] `src/core/health/indicators/s3.health.ts`

---

## Summary

| Category | Untested Files | Priority |
|----------|---------------|----------|
| Services | 92 | High |
| Repositories | 26 | High |
| Controllers | 26 | High |
| Serialisers | 21 | Medium |
| DTOs | 30+ | Medium |
| Entities | 25+ | Medium |
| Modules | 20+ | Low |
| Utilities | 15+ | Medium |
| Guards | 6 | High |
| Decorators | 6 | Medium |
| Factories | 7 | Medium |
| Strategies | 5 | Medium |
| Processors | 5 | High |
| Interceptors | 3 | Medium |
| Health Indicators | 4 | Low |
| Filters | 1 | Medium |

**Recommended Priority Order:**
1. Guards, Interceptors, Filters (security-critical)
2. Core Services (cache, neo4j, redis, security, jsonapi)
3. Processors (async job handling)
4. Controllers (API endpoints)
5. Repositories (data access layer)
6. Auth & OAuth services
7. Remaining services and utilities
