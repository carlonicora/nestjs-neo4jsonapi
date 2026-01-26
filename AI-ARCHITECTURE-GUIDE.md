# Backend Architecture Guide: NestJS + Neo4j + JSON:API

> **For AI Assistants**: This document explains the backend architecture patterns used in this codebase. Follow these patterns exactly. Deviating from them will produce broken, inconsistent code.

---

## Table of Contents

1. [Introduction & Core Principles](#1-introduction--core-principles)
2. [Module Structure](#2-module-structure)
3. [Entity Metadata](#3-entity-metadata)
4. [Entity Descriptors](#4-entity-descriptors)
5. [DTOs (Data Transfer Objects)](#5-dtos-data-transfer-objects)
6. [Repositories](#6-repositories)
7. [Services](#7-services)
8. [Controllers](#8-controllers)
9. [Complete Backend Templates](#9-complete-backend-templates)
10. [Backend Anti-Patterns](#10-backend-anti-patterns)

---

## 1. Introduction & Core Principles

This architecture provides **automatic, type-safe JSON:API compliance** for the backend.

### Core Principles

1. **JSON:API Spec Compliance**: All API responses follow the JSON:API specification automatically
2. **Type Safety**: TypeScript types flow from entity definitions through to API responses
3. **Security by Default**: Company-scoped queries are automatically filtered via ClsService
4. **No Manual Serialization**: Never write JSON:API structures by hand
5. **Repositories Return Objects**: NEVER raw Neo4j records

### Key Rules

> **If you're manually constructing JSON:API response structures, you're doing it wrong.**

> **Repositories ALWAYS return typed objects, NEVER raw Neo4j records.**

The architecture handles all serialization automatically through:
- **Entity Descriptors** + **AbstractService** + **AbstractRepository**

---

## 2. Module Structure

Every feature module follows this directory structure:

```
features/[domain]/[entity]/
├── [entity].module.ts           # Module definition
├── controllers/
│   └── [entity].controller.ts   # HTTP handlers
├── entities/
│   ├── [entity].ts              # Entity type + Descriptor
│   └── [entity].meta.ts         # Metadata constants
├── services/
│   └── [entity].service.ts      # Business logic
├── repositories/
│   └── [entity].repository.ts   # Data access
└── dtos/
    ├── [entity].dto.ts          # Reference DTO
    ├── [entity].post.dto.ts     # Create DTO
    └── [entity].put.dto.ts      # Update DTO
```

### Module Definition Pattern

```typescript
// gallery.module.ts
import { AuditModule, modelRegistry } from "@carlonicora/nestjs-neo4jsonapi";
import { Module, OnModuleInit } from "@nestjs/common";
import { GalleryController } from "./controllers/gallery.controller";
import { GalleryDescriptor } from "./entities/gallery";
import { GalleryRepository } from "./repositories/gallery.repository";
import { GalleryService } from "./services/gallery.service";

@Module({
  controllers: [GalleryController],
  providers: [
    GalleryDescriptor.model.serialiser,  // Auto-generated from descriptor
    GalleryRepository,
    GalleryService,
  ],
  exports: [GalleryRepository],
  imports: [AuditModule],
})
export class GalleryModule implements OnModuleInit {
  onModuleInit() {
    modelRegistry.register(GalleryDescriptor.model);  // Register with global registry
  }
}
```

---

## 3. Entity Metadata

Every entity has a metadata file defining its JSON:API type and Neo4j labels.

```typescript
// gallery.meta.ts
import { DataMeta } from "@carlonicora/nestjs-neo4jsonapi";

export const galleryMeta: DataMeta = {
  type: "galleries",        // JSON:API type (plural, kebab-case)
  endpoint: "galleries",    // HTTP endpoint path
  nodeName: "gallery",      // Neo4j query variable name
  labelName: "Gallery",     // Neo4j node label (PascalCase)
};
```

---

## 4. Entity Descriptors

The Entity Descriptor is the **single source of truth** for an entity. It defines:
- Fields (attributes)
- Computed properties
- Relationships
- Transforms (e.g., S3 signed URLs)

### Entity Type Definition

```typescript
// gallery.ts
import { Company, defineEntity, Entity, ownerMeta, S3Service, User } from "@carlonicora/nestjs-neo4jsonapi";
import { galleryMeta } from "./gallery.meta";
import { Photograph } from "../../photograph/entities/photograph";
import { photographMeta } from "../../photograph/entities/photograph.meta";
import { Person } from "../../person/entities/person";
import { personMeta } from "../../person/entities/person.meta";

/**
 * Entity Type - TypeScript type definition
 * Extends Entity base type with entity-specific properties
 */
export type Gallery = Entity & {
  name: string;
  description?: string;
  samplePhotographs?: string[];
  photoCount?: number;
  company: Company;
  owner: User;
  photograph?: Photograph[];
  person?: Person[];
};
```

### Entity Descriptor Definition

```typescript
export const GalleryDescriptor = defineEntity<Gallery>()({
  ...galleryMeta,  // Spread metadata

  // Services available in transforms
  injectServices: [S3Service],

  // Field definitions (atomic properties stored in Neo4j node)
  fields: {
    name: { type: "string", required: true },
    description: { type: "string" },
    samplePhotographs: {
      type: "string[]",
      // Transform: convert S3 keys to signed URLs
      transform: async (data, services) => {
        if (!data.samplePhotographs?.length) return [];
        return Promise.all(
          data.samplePhotographs.map((url: string) =>
            services.S3Service.generateSignedUrl({ key: url })
          )
        );
      },
    },
    photoCount: { type: "number" },
  },

  // Computed properties (derived from Neo4j query results)
  computed: {
    samplePhotographs: {
      compute: (params) => {
        if (!params.record.has("samplePhotos")) return [];
        const photographs = params.record.get("samplePhotos") || [];
        return photographs.map((p: any) => p?.properties?.url).filter(Boolean);
      },
    },
    photoCount: {
      compute: (params) => {
        if (!params.record.has("photoCount")) return params.data?.photoCount;
        const count = params.record.get("photoCount");
        if (count?.toNumber) return count.toNumber();
        return Number(count) || 0;
      },
    },
  },

  // Relationship definitions
  relationships: {
    owner: {
      model: ownerMeta,
      direction: "in",           // Incoming relationship
      relationship: "CREATED",   // Neo4j relationship type
      cardinality: "one",        // Single relationship
      dtoKey: "owner",           // Key in DTOs
    },
    photograph: {
      model: photographMeta,
      direction: "out",
      relationship: "CONTAINS",
      cardinality: "many",       // Collection
      required: false,
      dtoKey: "photographs",
      // Edge properties (stored on the relationship)
      fields: [{ name: "position", type: "number", required: true }],
    },
    person: {
      model: personMeta,
      direction: "in",
      relationship: "HAS_ACCESS_TO",
      cardinality: "many",
      required: false,
      dtoKey: "persons",
      // Edge properties for access control
      fields: [
        { name: "code", type: "string", required: true },
        { name: "expiresAt", type: "datetime", required: false },
      ],
    },
  },
});

export type GalleryDescriptorType = typeof GalleryDescriptor;
```

### Field Types

| Type | Description | Neo4j Type |
|------|-------------|------------|
| `"string"` | Text | String |
| `"number"` | Numeric | Integer/Float |
| `"boolean"` | True/false | Boolean |
| `"date"` | Date only | Date |
| `"datetime"` | Date and time | DateTime |
| `"string[]"` | Array of strings | List<String> |
| `"number[]"` | Array of numbers | List<Integer> |

---

## 5. DTOs (Data Transfer Objects)

DTOs validate incoming JSON:API requests. They follow a strict nested structure.

### JSON:API Request Structure

```json
{
  "data": {
    "type": "galleries",
    "id": "uuid-here",
    "attributes": {
      "name": "My Gallery",
      "description": "A description"
    },
    "relationships": {
      "owner": {
        "data": { "type": "users", "id": "user-uuid" }
      },
      "photographs": {
        "data": [
          { "type": "photographs", "id": "photo-1", "meta": { "position": 1 } }
        ]
      }
    }
  }
}
```

### Reference DTO (for relationship references)

```typescript
// gallery.dto.ts
import { Type } from "class-transformer";
import { Equals, IsNotEmpty, IsUUID, ValidateNested } from "class-validator";
import { galleryMeta } from "../entities/gallery.meta";

export class GalleryDTO {
  @Equals(galleryMeta.endpoint)  // Must match type
  type: string;

  @IsUUID()
  id: string;
}

export class GalleryDataDTO {
  @ValidateNested()
  @IsNotEmpty()
  @Type(() => GalleryDTO)
  data: GalleryDTO;
}

export class GalleryDataListDTO {
  @ValidateNested({ each: true })
  @IsNotEmpty()
  @Type(() => GalleryDTO)
  data: GalleryDTO[];
}
```

### POST DTO (Create)

```typescript
// gallery.post.dto.ts
import { UserDataDTO } from "@carlonicora/nestjs-neo4jsonapi";
import { Type } from "class-transformer";
import {
  Equals, IsDefined, IsNotEmpty, IsOptional,
  IsString, IsUUID, ValidateNested,
} from "class-validator";
import { galleryMeta } from "../entities/gallery.meta";

// Attributes for creation
export class GalleryPostAttributesDTO {
  @IsDefined()
  @IsNotEmpty()
  @IsString()
  name: string;

  @IsOptional()
  @IsString()
  description?: string;
}

// Relationships for creation
export class GalleryPostRelationshipsDTO {
  @ValidateNested()
  @IsDefined()
  @Type(() => UserDataDTO)
  owner: UserDataDTO;
}

// Complete data structure
export class GalleryPostDataDTO {
  @Equals(galleryMeta.endpoint)
  type: string;

  @IsUUID()
  id: string;

  @ValidateNested()
  @IsNotEmpty()
  @Type(() => GalleryPostAttributesDTO)
  attributes: GalleryPostAttributesDTO;

  @ValidateNested()
  @IsNotEmpty()
  @Type(() => GalleryPostRelationshipsDTO)
  relationships: GalleryPostRelationshipsDTO;
}

// Top-level wrapper
export class GalleryPostDTO {
  @ValidateNested()
  @IsNotEmpty()
  @Type(() => GalleryPostDataDTO)
  data: GalleryPostDataDTO;
}
```

### PUT DTO (Full Update)

```typescript
// gallery.put.dto.ts
import { UserDataDTO } from "@carlonicora/nestjs-neo4jsonapi";
import { Type } from "class-transformer";
import {
  Equals, IsDefined, IsNotEmpty, IsOptional,
  IsString, IsUUID, ValidateNested,
} from "class-validator";
import { galleryMeta } from "../entities/gallery.meta";

export class GalleryPutAttributesDTO {
  @IsDefined()
  @IsNotEmpty()
  @IsString()
  name: string;

  @IsOptional()
  @IsString()
  description?: string;
}

export class GalleryPutRelationshipsDTO {
  @ValidateNested()
  @IsDefined()
  @Type(() => UserDataDTO)
  owner: UserDataDTO;
}

export class GalleryPutDataDTO {
  @Equals(galleryMeta.endpoint)
  type: string;

  @IsUUID()
  id: string;

  @ValidateNested()
  @IsNotEmpty()
  @Type(() => GalleryPutAttributesDTO)
  attributes: GalleryPutAttributesDTO;

  @ValidateNested()
  @IsNotEmpty()
  @Type(() => GalleryPutRelationshipsDTO)
  relationships: GalleryPutRelationshipsDTO;
}

export class GalleryPutDTO {
  @ValidateNested()
  @IsNotEmpty()
  @Type(() => GalleryPutDataDTO)
  data: GalleryPutDataDTO;
}
```

---

## 6. Repositories

Repositories handle data access. They extend `AbstractRepository` which provides automatic:
- Company filtering via ClsService
- Typed object mapping (NEVER raw Neo4j records)
- Pagination via `{CURSOR}` placeholder

### CRITICAL RULES

1. **ALWAYS use `readOne` or `readMany`** - they return typed objects
2. **NEVER return raw Neo4j records**
3. **ALWAYS use `{CURSOR}`** for paginated queries
4. **Company filtering is automatic** via `buildDefaultMatch()`

### How Company Injection Works

The `ClsService` (Continuation Local Storage) stores the authenticated user's `companyId` from the JWT token. When you call `buildDefaultMatch()`, it automatically:

1. Retrieves `companyId` from ClsService
2. Adds a `WHERE` clause filtering by company
3. Ensures data isolation between companies

You **never** need to manually filter by company.

### How {CURSOR} Works

The `{CURSOR}` placeholder is replaced at query execution time:
- If pagination offset exists: `SKIP toInteger($cursor) LIMIT toInteger($take)`
- If no offset (first page): `LIMIT toInteger($take)`
- If `fetchAll=true`: Removed entirely (no pagination)

### Repository Pattern

```typescript
// gallery.repository.ts
import {
  AbstractRepository,
  companyMeta,
  JsonApiCursorInterface,
  Neo4jService,
  ownerMeta,
  SecurityService,
} from "@carlonicora/nestjs-neo4jsonapi";
import { Injectable } from "@nestjs/common";
import { ClsService } from "nestjs-cls";
import { Gallery, GalleryDescriptor } from "../entities/gallery";
import { galleryMeta } from "../entities/gallery.meta";
import { photographMeta } from "../../photograph/entities/photograph.meta";

@Injectable()
export class GalleryRepository extends AbstractRepository<Gallery, typeof GalleryDescriptor.relationships> {
  protected readonly descriptor = GalleryDescriptor;

  constructor(
    neo4j: Neo4jService,
    securityService: SecurityService,
    clsService: ClsService,
  ) {
    super(neo4j, securityService, clsService);
  }

  /**
   * Override to customize the RETURN statement for all queries
   * This adds computed fields like sample photos and counts
   */
  protected buildReturnStatement(): string {
    return `
      MATCH (${galleryMeta.nodeName}:${galleryMeta.labelName})-[:BELONGS_TO]->(${galleryMeta.nodeName}_${companyMeta.nodeName}:${companyMeta.labelName})
      MATCH (${galleryMeta.nodeName})<-[:CREATED]-(${galleryMeta.nodeName}_${ownerMeta.nodeName}:${ownerMeta.labelName})
      CALL {
        WITH ${galleryMeta.nodeName}
        OPTIONAL MATCH (${galleryMeta.nodeName})-[:CONTAINS]->(photo:${photographMeta.labelName})
        WITH ${galleryMeta.nodeName}, count(photo) as photoCount
        OPTIONAL MATCH (${galleryMeta.nodeName})-[:CONTAINS]->(topPhoto:${photographMeta.labelName})
        WITH ${galleryMeta.nodeName}, photoCount, topPhoto ORDER BY topPhoto.position
        WITH ${galleryMeta.nodeName}, photoCount, collect(topPhoto)[0..4] as samplePhotos
        RETURN samplePhotos, photoCount
      }
      RETURN ${galleryMeta.nodeName},
        ${galleryMeta.nodeName}_${companyMeta.nodeName},
        ${galleryMeta.nodeName}_${ownerMeta.nodeName},
        samplePhotos,
        photoCount
    `;
  }

  /**
   * Custom query: Find galleries with pending reviews
   */
  async findPendingReviews(params: { cursor: JsonApiCursorInterface }): Promise<Gallery[]> {
    const query = this.neo4j.initQuery({
      serialiser: GalleryDescriptor.model,
      cursor: params.cursor,
    });

    query.query = `
      ${this.buildDefaultMatch()}
      MATCH (${galleryMeta.nodeName})<-[access:HAS_ACCESS_TO]-(person:Person)
      WHERE access.completed = false
      ORDER BY ${galleryMeta.nodeName}.createdAt DESC
      {CURSOR}
      ${this.buildReturnStatement()}
    `;

    return this.neo4j.readMany(query);  // Returns Gallery[], not Neo4j records!
  }
}
```

### WRONG vs RIGHT Examples

```typescript
// ❌ WRONG - Returning raw Neo4j records
async findById(id: string) {
  const result = await this.neo4j.read(
    `MATCH (n:Gallery {id: $id}) RETURN n`,
    { id }
  );
  return result.records[0];  // RAW RECORD - WRONG!
}

// ✅ CORRECT - Using readOne with serialiser
async findById(params: { id: string }): Promise<Gallery> {
  const query = this.neo4j.initQuery({ serialiser: GalleryDescriptor.model });
  query.queryParams = { ...query.queryParams, searchValue: params.id };
  query.query = `
    ${this.buildDefaultMatch({ searchField: "id" })}
    ${this.buildReturnStatement()}
  `;
  return this.neo4j.readOne(query);  // Returns typed Gallery object
}
```

```typescript
// ❌ WRONG - Manual company filtering
async find() {
  const companyId = this.clsService.get("companyId");
  return this.neo4j.read(
    `MATCH (n:Gallery)-[:BELONGS_TO]->(c:Company {id: $companyId}) RETURN n`,
    { companyId }
  );
}

// ✅ CORRECT - buildDefaultMatch() auto-injects company
async find(params: { cursor: JsonApiCursorInterface }): Promise<Gallery[]> {
  const query = this.neo4j.initQuery({
    serialiser: GalleryDescriptor.model,
    cursor: params.cursor,
  });
  query.query = `
    ${this.buildDefaultMatch()}
    ORDER BY ${galleryMeta.nodeName}.name ASC
    {CURSOR}
    ${this.buildReturnStatement()}
  `;
  return this.neo4j.readMany(query);  // Auto-filtered by company!
}
```

```typescript
// ❌ WRONG - Manual pagination
query.query = `MATCH (n) RETURN n SKIP ${offset} LIMIT ${limit}`;

// ✅ CORRECT - Using {CURSOR} placeholder
query.query = `
  MATCH (n:Gallery)
  ORDER BY n.name
  {CURSOR}
  RETURN n
`;  // {CURSOR} replaced with SKIP/LIMIT automatically
```

---

## 7. Services

Services handle business logic. They extend `AbstractService` which provides:
- `find`, `findById`, `findByRelated` (inherited)
- `createFromDTO`, `putFromDTO`, `patchFromDTO` (inherited)
- Automatic JSON:API response building

### Service Pattern

```typescript
// gallery.service.ts
import { AbstractService, JsonApiService, JsonApiPaginator } from "@carlonicora/nestjs-neo4jsonapi";
import { Injectable } from "@nestjs/common";
import { ClsService } from "nestjs-cls";
import { Gallery, GalleryDescriptor } from "../entities/gallery";
import { GalleryRepository } from "../repositories/gallery.repository";

@Injectable()
export class GalleryService extends AbstractService<Gallery, typeof GalleryDescriptor.relationships> {
  protected readonly descriptor = GalleryDescriptor;

  constructor(
    jsonApiService: JsonApiService,
    private readonly galleryRepository: GalleryRepository,
    clsService: ClsService,
  ) {
    super(jsonApiService, galleryRepository, clsService, GalleryDescriptor.model);
  }

  // Inherited methods available:
  // - find({ query, term?, fetchAll?, orderBy? })
  // - findById({ id })
  // - findByRelated({ relationship, id, query?, term?, fetchAll?, orderBy? })
  // - createFromDTO({ data: JsonApiDTOData })
  // - putFromDTO({ data: JsonApiDTOData })
  // - patchFromDTO({ data: JsonApiDTOData })
  // - delete({ id })

  /**
   * Custom business logic: Find galleries pending review
   */
  async findPendingReviews(params: { query: any }): Promise<any> {
    const paginator = new JsonApiPaginator(params.query);
    const data = await this.galleryRepository.findPendingReviews({
      cursor: paginator.generateCursor(),
    });
    return this.jsonApiService.buildList(GalleryDescriptor.model, data, paginator);
  }
}
```

---

## 8. Controllers

Controllers handle HTTP requests. They use meta constants for endpoints.

### Controller Pattern

```typescript
// gallery.controller.ts
import {
  AuditService,
  AuthenticatedRequest,
  CacheService,
  JsonApiDTOData,
  JwtAuthGuard,
  ownerMeta,
} from "@carlonicora/nestjs-neo4jsonapi";
import {
  Body, Controller, Delete, Get, HttpCode, HttpStatus,
  Param, Post, PreconditionFailedException, Put, Query,
  Req, Res, UseGuards,
} from "@nestjs/common";
import { FastifyReply } from "fastify";
import { GalleryDescriptor } from "../entities/gallery";
import { galleryMeta } from "../entities/gallery.meta";
import { GalleryPostDTO } from "../dtos/gallery.post.dto";
import { GalleryPutDTO } from "../dtos/gallery.put.dto";
import { GalleryService } from "../services/gallery.service";

@UseGuards(JwtAuthGuard)
@Controller()
export class GalleryController {
  constructor(
    private readonly galleryService: GalleryService,
    private readonly cacheService: CacheService,
    private readonly auditService: AuditService,
  ) {}

  // GET /galleries
  @Get(galleryMeta.endpoint)
  async findAll(
    @Req() req: AuthenticatedRequest,
    @Res() reply: FastifyReply,
    @Query() query: any,
    @Query("search") search?: string,
    @Query("fetchAll") fetchAll?: boolean,
    @Query("orderBy") orderBy?: string,
  ) {
    const response = await this.galleryService.find({
      term: search,
      query: query,
      fetchAll: fetchAll,
      orderBy: orderBy,
    });
    reply.send(response);
  }

  // GET /galleries/:id
  @Get(`${galleryMeta.endpoint}/:galleryId`)
  async findById(
    @Req() req: AuthenticatedRequest,
    @Res() reply: FastifyReply,
    @Param("galleryId") galleryId: string,
  ) {
    const response = await this.galleryService.findById({ id: galleryId });
    reply.send(response);

    this.auditService.createAuditEntry({
      entityType: galleryMeta.labelName,
      entityId: galleryId,
    });
  }

  // POST /galleries
  @Post(galleryMeta.endpoint)
  async create(
    @Req() req: AuthenticatedRequest,
    @Res() reply: FastifyReply,
    @Body() body: GalleryPostDTO,
  ) {
    const response = await this.galleryService.createFromDTO({
      data: body.data as unknown as JsonApiDTOData,
    });
    reply.send(response);
    await this.cacheService.invalidateByType(galleryMeta.endpoint);
  }

  // PUT /galleries/:id
  @Put(`${galleryMeta.endpoint}/:galleryId`)
  async update(
    @Req() req: AuthenticatedRequest,
    @Res() reply: FastifyReply,
    @Param("galleryId") galleryId: string,
    @Body() body: GalleryPutDTO,
  ) {
    if (galleryId !== body.data.id) {
      throw new PreconditionFailedException("ID mismatch");
    }

    const response = await this.galleryService.putFromDTO({
      data: body.data as unknown as JsonApiDTOData,
    });
    reply.send(response);
    await this.cacheService.invalidateByElement(galleryMeta.endpoint, body.data.id);
  }

  // DELETE /galleries/:id
  @Delete(`${galleryMeta.endpoint}/:galleryId`)
  @HttpCode(HttpStatus.NO_CONTENT)
  async delete(
    @Req() req: AuthenticatedRequest,
    @Res() reply: FastifyReply,
    @Param("galleryId") galleryId: string,
  ) {
    await this.galleryService.delete({ id: galleryId });
    reply.send();
    await this.cacheService.invalidateByElement(galleryMeta.endpoint, galleryId);
  }

  // GET /users/:userId/galleries (nested endpoint)
  @Get(`${ownerMeta.endpoint}/:userId/${GalleryDescriptor.model.endpoint}`)
  async findByOwner(
    @Req() req: AuthenticatedRequest,
    @Res() reply: FastifyReply,
    @Param("userId") userId: string,
    @Query() query: any,
  ) {
    const response = await this.galleryService.findByRelated({
      relationship: GalleryDescriptor.relationshipKeys.owner,
      id: userId,
      query: query,
    });
    reply.send(response);
  }
}
```

---

## 9. Complete Backend Templates

### Step 1: Create Metadata

```typescript
// src/features/[domain]/[entity]/entities/[entity].meta.ts
import { DataMeta } from "@carlonicora/nestjs-neo4jsonapi";

export const exampleMeta: DataMeta = {
  type: "examples",
  endpoint: "examples",
  nodeName: "example",
  labelName: "Example",
};
```

### Step 2: Create Entity & Descriptor

```typescript
// src/features/[domain]/[entity]/entities/[entity].ts
import { Company, defineEntity, Entity, ownerMeta, User } from "@carlonicora/nestjs-neo4jsonapi";
import { exampleMeta } from "./example.meta";

export type Example = Entity & {
  name: string;
  description?: string;
  company: Company;
  owner: User;
};

export const ExampleDescriptor = defineEntity<Example>()({
  ...exampleMeta,

  fields: {
    name: { type: "string", required: true },
    description: { type: "string" },
  },

  relationships: {
    owner: {
      model: ownerMeta,
      direction: "in",
      relationship: "CREATED",
      cardinality: "one",
      dtoKey: "owner",
    },
  },
});

export type ExampleDescriptorType = typeof ExampleDescriptor;
```

### Step 3: Create DTOs

```typescript
// src/features/[domain]/[entity]/dtos/[entity].dto.ts
import { Type } from "class-transformer";
import { Equals, IsNotEmpty, IsUUID, ValidateNested } from "class-validator";
import { exampleMeta } from "../entities/example.meta";

export class ExampleDTO {
  @Equals(exampleMeta.endpoint)
  type: string;

  @IsUUID()
  id: string;
}

export class ExampleDataDTO {
  @ValidateNested()
  @IsNotEmpty()
  @Type(() => ExampleDTO)
  data: ExampleDTO;
}
```

```typescript
// src/features/[domain]/[entity]/dtos/[entity].post.dto.ts
import { UserDataDTO } from "@carlonicora/nestjs-neo4jsonapi";
import { Type } from "class-transformer";
import { Equals, IsDefined, IsNotEmpty, IsOptional, IsString, IsUUID, ValidateNested } from "class-validator";
import { exampleMeta } from "../entities/example.meta";

export class ExamplePostAttributesDTO {
  @IsDefined()
  @IsNotEmpty()
  @IsString()
  name: string;

  @IsOptional()
  @IsString()
  description?: string;
}

export class ExamplePostRelationshipsDTO {
  @ValidateNested()
  @IsDefined()
  @Type(() => UserDataDTO)
  owner: UserDataDTO;
}

export class ExamplePostDataDTO {
  @Equals(exampleMeta.endpoint)
  type: string;

  @IsUUID()
  id: string;

  @ValidateNested()
  @IsNotEmpty()
  @Type(() => ExamplePostAttributesDTO)
  attributes: ExamplePostAttributesDTO;

  @ValidateNested()
  @IsNotEmpty()
  @Type(() => ExamplePostRelationshipsDTO)
  relationships: ExamplePostRelationshipsDTO;
}

export class ExamplePostDTO {
  @ValidateNested()
  @IsNotEmpty()
  @Type(() => ExamplePostDataDTO)
  data: ExamplePostDataDTO;
}
```

### Step 4: Create Repository

```typescript
// src/features/[domain]/[entity]/repositories/[entity].repository.ts
import {
  AbstractRepository,
  Neo4jService,
  SecurityService,
} from "@carlonicora/nestjs-neo4jsonapi";
import { Injectable } from "@nestjs/common";
import { ClsService } from "nestjs-cls";
import { Example, ExampleDescriptor } from "../entities/example";

@Injectable()
export class ExampleRepository extends AbstractRepository<Example, typeof ExampleDescriptor.relationships> {
  protected readonly descriptor = ExampleDescriptor;

  constructor(
    neo4j: Neo4jService,
    securityService: SecurityService,
    clsService: ClsService,
  ) {
    super(neo4j, securityService, clsService);
  }
}
```

### Step 5: Create Service

```typescript
// src/features/[domain]/[entity]/services/[entity].service.ts
import { AbstractService, JsonApiService } from "@carlonicora/nestjs-neo4jsonapi";
import { Injectable } from "@nestjs/common";
import { ClsService } from "nestjs-cls";
import { Example, ExampleDescriptor } from "../entities/example";
import { ExampleRepository } from "../repositories/example.repository";

@Injectable()
export class ExampleService extends AbstractService<Example, typeof ExampleDescriptor.relationships> {
  protected readonly descriptor = ExampleDescriptor;

  constructor(
    jsonApiService: JsonApiService,
    private readonly exampleRepository: ExampleRepository,
    clsService: ClsService,
  ) {
    super(jsonApiService, exampleRepository, clsService, ExampleDescriptor.model);
  }
}
```

### Step 6: Create Controller

```typescript
// src/features/[domain]/[entity]/controllers/[entity].controller.ts
import {
  AuditService,
  AuthenticatedRequest,
  CacheService,
  JsonApiDTOData,
  JwtAuthGuard,
} from "@carlonicora/nestjs-neo4jsonapi";
import {
  Body, Controller, Delete, Get, HttpCode, HttpStatus,
  Param, Post, PreconditionFailedException, Put, Query,
  Req, Res, UseGuards,
} from "@nestjs/common";
import { FastifyReply } from "fastify";
import { exampleMeta } from "../entities/example.meta";
import { ExamplePostDTO } from "../dtos/example.post.dto";
import { ExamplePutDTO } from "../dtos/example.put.dto";
import { ExampleService } from "../services/example.service";

@UseGuards(JwtAuthGuard)
@Controller()
export class ExampleController {
  constructor(
    private readonly exampleService: ExampleService,
    private readonly cacheService: CacheService,
    private readonly auditService: AuditService,
  ) {}

  @Get(exampleMeta.endpoint)
  async findAll(
    @Req() req: AuthenticatedRequest,
    @Res() reply: FastifyReply,
    @Query() query: any,
    @Query("search") search?: string,
    @Query("fetchAll") fetchAll?: boolean,
    @Query("orderBy") orderBy?: string,
  ) {
    const response = await this.exampleService.find({
      term: search,
      query: query,
      fetchAll: fetchAll,
      orderBy: orderBy,
    });
    reply.send(response);
  }

  @Get(`${exampleMeta.endpoint}/:exampleId`)
  async findById(
    @Req() req: AuthenticatedRequest,
    @Res() reply: FastifyReply,
    @Param("exampleId") exampleId: string,
  ) {
    const response = await this.exampleService.findById({ id: exampleId });
    reply.send(response);
  }

  @Post(exampleMeta.endpoint)
  async create(
    @Req() req: AuthenticatedRequest,
    @Res() reply: FastifyReply,
    @Body() body: ExamplePostDTO,
  ) {
    const response = await this.exampleService.createFromDTO({
      data: body.data as unknown as JsonApiDTOData,
    });
    reply.send(response);
    await this.cacheService.invalidateByType(exampleMeta.endpoint);
  }

  @Put(`${exampleMeta.endpoint}/:exampleId`)
  async update(
    @Req() req: AuthenticatedRequest,
    @Res() reply: FastifyReply,
    @Param("exampleId") exampleId: string,
    @Body() body: ExamplePutDTO,
  ) {
    if (exampleId !== body.data.id) {
      throw new PreconditionFailedException("ID mismatch");
    }
    const response = await this.exampleService.putFromDTO({
      data: body.data as unknown as JsonApiDTOData,
    });
    reply.send(response);
    await this.cacheService.invalidateByElement(exampleMeta.endpoint, body.data.id);
  }

  @Delete(`${exampleMeta.endpoint}/:exampleId`)
  @HttpCode(HttpStatus.NO_CONTENT)
  async delete(
    @Req() req: AuthenticatedRequest,
    @Res() reply: FastifyReply,
    @Param("exampleId") exampleId: string,
  ) {
    await this.exampleService.delete({ id: exampleId });
    reply.send();
    await this.cacheService.invalidateByElement(exampleMeta.endpoint, exampleId);
  }
}
```

### Step 7: Create Module

```typescript
// src/features/[domain]/[entity]/[entity].module.ts
import { AuditModule, modelRegistry } from "@carlonicora/nestjs-neo4jsonapi";
import { Module, OnModuleInit } from "@nestjs/common";
import { ExampleController } from "./controllers/example.controller";
import { ExampleDescriptor } from "./entities/example";
import { ExampleRepository } from "./repositories/example.repository";
import { ExampleService } from "./services/example.service";

@Module({
  controllers: [ExampleController],
  providers: [
    ExampleDescriptor.model.serialiser,
    ExampleRepository,
    ExampleService,
  ],
  exports: [ExampleRepository],
  imports: [AuditModule],
})
export class ExampleModule implements OnModuleInit {
  onModuleInit() {
    modelRegistry.register(ExampleDescriptor.model);
  }
}
```

---

## 10. Backend Anti-Patterns

| Anti-Pattern | Why It's Wrong | Correct Approach |
|--------------|---------------|------------------|
| Returning raw Neo4j records | No type safety, breaks serialization | Use `readOne`/`readMany` with serialiser |
| Manual company filtering | Security risk, inconsistent | Use `buildDefaultMatch()` |
| Manual pagination | Inconsistent, error-prone | Use `{CURSOR}` placeholder |
| Manual JSON:API construction | Breaks spec compliance | Use `JsonApiService.buildSingle/buildList` |
| Not extending AbstractRepository | Loses company filtering, typed mapping | Always extend `AbstractRepository` |
| Not extending AbstractService | Loses DTO handling, JSON:API building | Always extend `AbstractService` |
| Using `this.neo4j.read()` directly | Returns raw records, no mapping | Use `this.neo4j.readOne()` or `readMany()` |
| Hardcoding company ID in queries | Bypasses security, breaks multi-tenancy | Let `buildDefaultMatch()` handle it |

---

## Summary

This backend architecture provides:

1. **Type Safety**: TypeScript types from descriptor → DTO → response
2. **Security**: Automatic company filtering via ClsService
3. **Consistency**: JSON:API compliance without manual work
4. **Simplicity**: Inherit from abstract classes, get CRUD for free

**Follow these patterns exactly. Deviating creates broken, inconsistent code.**
