# MCP Server

`@carlonicora/nestjs-neo4jsonapi` ships a built-in [Model Context Protocol](https://modelcontextprotocol.io)
server that exposes a consuming app's entity graph to AI agents (claude.ai
connectors, Claude Desktop, Claude Code, MCP Inspector, custom agents). The
agent always acts **as an authenticated user** via OAuth 2.1: tenant isolation
(`buildDefaultMatch()`) and RBAC apply to every tool call by construction.

- **Endpoint:** `POST /mcp` (Streamable HTTP, stateless — `GET`/`DELETE` return 405)
- **Auth:** OAuth `authorization_code` + PKCE against the library's oauth foundation
- **Tools:** generic graph tools + config-promoted per-entity tools + app-contributed tools
- **Writes:** create / partial-update / relationship add & remove — no deletes

## Prerequisites

The MCP module composes existing library machinery. A consuming app needs:

| Prerequisite | Why |
|---|---|
| `agents` NOT disabled in bootstrap | `GraphCatalogService`, `EntityServiceRegistry`, and the graph tools live in `AgentsModule` |
| Entity descriptors registered via `graphRegistry.register(...)` **with `description` fields** | The catalog only exposes entities that carry a description — no description, no tool access |
| OAuth foundation enabled (`OAUTH_ENABLED=true`) | The MCP endpoint is an OAuth 2.1 resource server |
| Web app with the consent page (`app/[locale]/(auth)/oauth/authorize` using `OAuthConsentScreen` from `@carlonicora/nextjs-jsonapi`) | The browser-facing `authorization_endpoint` lives on the WEB app; the API's `/oauth/authorize` is Bearer-guarded and not browser-navigable |
| RBAC graph (`RbacModule.register` matrix, `(Role)-[:HAS_PERMISSIONS]->(Module)`, Feature/Module subscription graph) | Read visibility uses `UserModulesRepository.findModuleIdsForUser`; writes check `RbacPermissionService.can(userId, moduleId, action)` |
| `API_URL` and `APP_URL` set | OAuth discovery metadata is composed from them |

> **Known limitation (v1):** `McpModule` imports `OAuthModule` and `AgentsModule`,
> which transitively pull the library `UserModule`/`CompanyModule` controllers.
> Apps that run `foundations: { disabled: true }` and serve their own
> `users`/`companies` endpoints (e.g. a360ai) will crash on boot with duplicate
> Fastify routes if they set `mcp: true`. Fix planned: narrow the imports to a
> controller-less `OAuthTokenModule` (guard + token validation only) and
> `GraphModule` instead of the full `AgentsModule` — mirroring how
> `RbacPermissionModule` is already controller-less. Until then, MCP is only
> mountable in apps using the library foundations.

## Setup

### 1. Bootstrap flag

```ts
// apps/api/src/main.ts
bootstrap({
  appModules: [FeaturesModules],
  // ...
  mcp: true, // mounts McpModule at POST /mcp
});
```

### 2. Environment

```bash
# MCP
MCP_ENABLED=true                     # runtime switch; endpoint 404s when false
MCP_SERVER_NAME=my-erp               # shown to connecting clients
MCP_INSTRUCTIONS="Call describe_entity before reading or writing any entity type."
MCP_PROMOTED_ENTITIES=orders,quotes  # JSON:API types promoted to dedicated tools

# Required by the OAuth flow
OAUTH_ENABLED=true
API_URL=https://api.example.com      # issuer + token/registration/discovery endpoints
APP_URL=https://app.example.com      # hosts the browser consent page
```

`MCP_PROMOTED_ENTITIES` values are the **JSON:API `type` strings** from each
entity's meta (`orderMeta.type === "orders"`, `"work-orders"`, …) — check the
meta files, don't guess.

### 3. That's it

On boot the server self-assembles from the registries: OAuth discovery
documents at `/.well-known/oauth-authorization-server` and
`/.well-known/oauth-protected-resource`, RFC 7591 Dynamic Client Registration
at `POST /oauth/register`, and the tool surface below.

## Tool surface

**Generic core** (always present):

| Tool | Kind | Notes |
|---|---|---|
| `describe_entity` | read | Descriptor → fields, relationships, filter/sort markers |
| `resolve_entity` | read | Fuzzy name → ranked entity candidates |
| `search_entities` | read | Filters, sort, cursor pagination |
| `read_entity` | read | One record by id, optional one-hop includes |
| `traverse` | read | Walk a relationship from a known record |
| `search_documents` | read | GraphRAG document retrieval with chunk citations |
| `create_entity` | write | Generates the id, dispatches `createFromDTO` |
| `update_entity` | write | **Partial** update via `patchFromDTO` — only provided attributes change, relationships untouched |
| `add_relationship` / `remove_relationship` | write | To-many edge changes via the relationship handlers |

**Promoted tools:** each type in `MCP_PROMOTED_ENTITIES` also gets
`search_<type>` / `get_<type>` / `create_<type>` / `update_<type>` with JSON
Schemas generated from its descriptor — pure discoverability sugar delegating
to the same executors.

**App-contributed tools:** provide the `MCP_TOOLS` token (array of
`McpToolContribution`, mirroring `OPERATOR_TOOLS`) to add curated workflow
tools:

```ts
import { MCP_TOOLS, McpToolContribution } from "@carlonicora/nestjs-neo4jsonapi/mcp";

{ provide: MCP_TOOLS, useFactory: (...) => [myWorkflowToolContribution], inject: [...] }
```

## Governance

- **Visibility:** `tools/list` and every `type` argument are filtered by the
  user's readable modules (`findModuleIdsForUser`). Users never see or touch
  entities their role can't read.
- **Writes:** gated by the RBAC matrix (`create`/`update` per Module × Role)
  via `RbacPermissionService.can()`. No delete tools exist.
- **Annotations:** reads carry `readOnlyHint: true`; conforming clients prompt
  the user before any write tool runs.
- **Audit:** writes audit through `AbstractService` exactly like HTTP writes —
  the MCP layer adds no extra audit entries (and must not, or entries double).
- **Errors:** flat `{ code, message, ...meta }` payloads (`unknown_type`,
  `forbidden`, `validation_failed`, `not_found`, `internal`) designed for LLM
  self-correction — unknown types list the available catalog.

## Connecting clients

**MCP Inspector** (browser-based — see CORS note below):

```bash
npx @modelcontextprotocol/inspector
# Transport: Streamable HTTP, URL: https://api.example.com/mcp
```

**Claude Code:**

```bash
claude mcp add --transport http my-erp https://api.example.com/mcp
# then inside a session: /mcp → authenticate
```

**Claude Desktop** (local dev, no public URL needed):

```json
{ "mcpServers": { "my-erp": { "command": "npx", "args": ["mcp-remote", "https://api.example.com/mcp"] } } }
```

**claude.ai custom connector:** requires the API publicly reachable over
HTTPS; `API_URL` must be that public URL (discovery metadata is composed from
it). The consent page (`APP_URL`) only needs to be reachable by the *user's
browser*.

All clients follow the same flow: discovery → dynamic client registration →
browser login + consent on the web app → PKCE code exchange → Bearer-tokened
MCP session.

## Design notes & gotchas (learned the hard way)

- **`authorization_endpoint` points at the WEB app, not the API.** The API's
  `/oauth/authorize` route requires a Bearer header, which a browser
  navigation never carries. Discovery metadata advertises
  `${APP_URL}/oauth/authorize` (the consent page), which authenticates via the
  web session and calls the API's `authorize/approve` with the user's JWT.
- **`scope` is optional** (RFC 6749 §3.3). MCP clients like Claude Code omit
  it; the server defaults to the client's registered scopes. Don't add
  scope-required validation anywhere in the flow.
- **CORS:** browser-based clients (MCP Inspector) exchange the authorization
  code from their own origin — add that origin to `CORS_ORIGINS` in dev.
  Native apps (Claude Desktop, Claude Code) and server-side clients
  (claude.ai) are unaffected.
- **`update_entity` is PATCH, not PUT — deliberately.** The framework's
  `putFromDTO` maps *every* descriptor relationship and treats the ones absent
  from the DTO as "delete all edges". HTTP PUTs are safe because the frontend
  model always sends the full relationship set; an attributes-only MCP caller
  would silently strip every mutable relationship off the record. `patchFromDTO`
  changes only what is sent.
- **Describe-first is pre-seeded.** The graph tools enforce a
  describe-before-read contract via a per-turn recorder. MCP is stateless
  (fresh recorder per `tools/call`), so the MCP layer seeds the recorder with
  the requested type on every read — without this, every search would error
  and the "retry" guidance would loop forever.
- **`client_credentials` tokens are locked out by design (v1):** no `userId`
  → zero readable modules → no tools. Machine flows need their own permission
  model before being enabled.

## Testing checklist

1. `curl -s $API_URL/.well-known/oauth-authorization-server | jq` — metadata with web-app `authorization_endpoint`
2. `curl -si -X POST $API_URL/mcp -H "content-type: application/json" -d '{"jsonrpc":"2.0","id":1,"method":"initialize","params":{}}'` — expect **401** with `WWW-Authenticate: Bearer resource_metadata=...`
3. `curl -s -X POST $API_URL/oauth/register -H "content-type: application/json" -d '{"redirect_uris":["http://localhost:6274/oauth/callback"],"token_endpoint_auth_method":"none"}'` — expect **201** with a `client_id`
4. MCP Inspector: connect, complete OAuth, `tools/list`, `describe_entity`, `search_entities` (verify only your company's data), a write on a low-stakes record
5. RBAC: connect as a restricted user — module tools absent from `tools/list`, generic calls on hidden types return `unknown_type`
