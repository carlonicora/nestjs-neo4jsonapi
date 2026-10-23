# NestJS Neo4j JSON:API Library - CLAUDE.md

This package is a published npm library providing the NestJS foundation for JSON:API + Neo4j applications.

## Purpose

Provides:
- **Bootstrap system** - Single function to configure entire NestJS app
- **Abstract base classes** - Repository, Service, Controller patterns
- **JSON:API protocol** - Serialization/deserialization
- **Foundation services** - Auth, Company, S3, Email, WebSocket
- **LangChain integration** - AgentFactory for AI agents

## Package Structure

```
src/
├── bootstrap/       # bootstrap() function for app initialization
├── core/            # Core services (JsonApiService, Neo4jService)
├── foundations/     # Foundation features
│   ├── auth/        # Authentication & JWT
│   ├── security/    # Authorization & scoping
│   ├── company/     # Multi-tenancy
│   ├── s3/          # Cloud storage
│   ├── email/       # Transactional emails
│   └── websocket/   # Real-time updates
├── agents/          # LangChain agent integration
└── config/          # Configuration interfaces
```

## Core Exports

| Entry Point | Contents |
|-------------|----------|
| `main` | AbstractRepository, AbstractService, AbstractController |
| `core` | JsonApiService, Neo4jService, SecurityService |
| `foundations` | AuthService, CompanyService, S3Service, EmailService |
| `agents` | AgentFactory, LangChain utilities |
| `bootstrap` | bootstrap() function |

## Key Patterns

### Bootstrap Pattern
```typescript
import { bootstrap } from "@carlonicora/nestjs-neo4jsonapi";

bootstrap({
  appModules: [PhotographModule, RollModule],
  config: {
    database: { uri: process.env.NEO4J_URI },
    auth: { jwtSecret: process.env.JWT_SECRET },
  },
});
```

### AbstractRepository Pattern
```typescript
@Injectable()
export class PhotographRepository extends AbstractRepository<Photograph, PhotographRelationships> {
  constructor(
    protected readonly neo4jService: Neo4jService,
    protected readonly securityService: SecurityService,
  ) {
    super(neo4jService, securityService, photographMeta, PhotographDescriptor);
  }

  // Custom query methods
  async findByRoll(rollId: string): Promise<Photograph[]> {
    // Uses inherited query building methods
  }
}
```

### AbstractService Pattern
```typescript
@Injectable()
export class PhotographService extends AbstractService<Photograph, PhotographRelationships> {
  constructor(
    protected readonly repository: PhotographRepository,
    protected readonly jsonApiService: JsonApiService,
  ) {
    super(repository, jsonApiService, photographMeta, PhotographDescriptor);
  }

  // Business logic methods
  async analysePhotograph(id: string): Promise<Analysis> {
    // Custom business logic
  }
}
```

### Request Permission Gate (opt-in)

Off by default; an app with it off behaves exactly as before. Switch it on in `bootstrap({ permissions: { enforce: true } })` (API and worker).

- **Sections.** Every controller declares its section with `@ModuleACL({ module: <Module id> })` at class level. A handler-level `@ModuleACL` overrides the section and/or the action; a POST that only reads (search, preview, count) gets `@ModuleACL({ module, action: "read" })`. Library controllers use `CoreModuleId.*`.
- **Check.** `JwtAuthGuard`, `AdminJwtAuthGuard` and `OptionalJwtAuthGuard` (when a user authenticated) call `ModulePermissionGate.assert` after authentication. Action: GET/HEAD/OPTIONS read, POST create, PUT/PATCH update, DELETE delete. Permissions resolve once per request in the token's company plus platform memberships (never the legacy `BELONGS_TO` edge): `true` or a record path allows, `false`/absent refuses with 403. A read with no section is allowed. No administrator bypass.
- **Boot audit.** `ModulePermissionAuditService` refuses to start when a session-guarded write route has no section, or when a referenced section id has no `(:Module)` node.
- **Before switching on**, the app must: seed a `(Module)` node for every section its mounted controllers reference (including the `CoreModuleId` ones); declare a section on every session-guarded write route; give every role, the platform Administrator included, its grants in the `RbacMatrix` (the reconciler writes Administrator edges only while the gate is on).
- `RbacPermissionService.can()` delegates to the same resolver while the gate is on, so tool calls and HTTP routes never disagree.

## Rules for Changes

1. **Backward compatibility** - Breaking changes require major version bump
2. **Export all public APIs** - Add new exports to appropriate entry point
3. **Use NestJS DI** - All services use dependency injection
4. **Test abstractions** - Unit tests for base classes
5. **Document changes** - Update JSDoc for public APIs

## Testing

```bash
# Run library tests
pnpm --filter @carlonicora/nestjs-neo4jsonapi test

# Run with coverage
pnpm --filter @carlonicora/nestjs-neo4jsonapi test:coverage
```

## Publishing

- Package: `@carlonicora/nestjs-neo4jsonapi`
- Version: Managed in `package.json`
- Registry: npm

## Common Mistakes

| Mistake | Correct Approach |
|---------|------------------|
| Breaking public API | Create new method, deprecate old one |
| Missing export | Add to appropriate entry point index |
| Direct Neo4j access in services | Use repository layer |
| Hardcoded company filtering | Use SecurityService |
