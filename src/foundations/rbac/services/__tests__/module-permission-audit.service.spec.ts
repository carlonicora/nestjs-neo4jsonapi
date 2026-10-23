import { describe, expect, it, vi } from "vitest";
import type { Mocked } from "vitest";
import { Controller, Delete, Get, Post, UseGuards } from "@nestjs/common";
import { DiscoveryService, MetadataScanner, Reflector } from "@nestjs/core";
import { ModuleACL } from "../../../../common/decorators/module.decorator";
import { AdminJwtAuthGuard } from "../../../../common/guards/jwt.auth.admin.guard";
import { JwtAuthGuard } from "../../../../common/guards/jwt.auth.guard";
import { OptionalJwtAuthGuard } from "../../../../common/guards/jwt.auth.optional.guard";
import type { RbacPermissionRepository } from "../../repositories/rbac-permission.repository";
import { ModulePermissionAuditService } from "../module-permission-audit.service";

const SECTION = "section-known";
const MISSING_SECTION = "section-missing";

@UseGuards(JwtAuthGuard)
@ModuleACL({ module: SECTION })
@Controller("sectioned")
class SectionedController {
  @Get()
  list() {}
  @Post()
  create() {}
}

@UseGuards(JwtAuthGuard)
@Controller("unsectioned")
class UnsectionedWriteController {
  @Get()
  list() {}
  @Post("things")
  createThing() {}
}

@Controller("reads")
class UnsectionedReadController {
  @UseGuards(AdminJwtAuthGuard)
  @Get()
  list() {}
}

@Controller("public")
class PublicController {
  @Post()
  submit() {}
  @UseGuards(OptionalJwtAuthGuard)
  @ModuleACL({ module: SECTION })
  @Post("tracked")
  tracked() {}
}

@Controller("missing")
class MissingSectionController {
  @UseGuards(JwtAuthGuard)
  @ModuleACL({ module: MISSING_SECTION })
  @Delete(":id")
  remove() {}
}

function buildAudit(params: { controllers: any[]; enforce?: boolean; existing?: string[] }) {
  const discovery = {
    getControllers: vi.fn(() => params.controllers.map((metatype) => ({ metatype }))),
  } as unknown as Mocked<DiscoveryService>;
  const repository = {
    findExistingModuleIds: vi.fn(async (ids: string[]) => {
      const existing = new Set(params.existing ?? [SECTION]);
      return new Set(ids.filter((id) => existing.has(id)));
    }),
  } as unknown as Mocked<RbacPermissionRepository>;
  const audit = new ModulePermissionAuditService(
    discovery,
    new MetadataScanner(),
    new Reflector(),
    repository,
    params.enforce,
  );
  return { audit, discovery, repository };
}

describe("ModulePermissionAuditService", () => {
  it("enforce off → no scan", async () => {
    for (const enforce of [false, undefined]) {
      const { audit, discovery, repository } = buildAudit({ controllers: [UnsectionedWriteController], enforce });
      await expect(audit.onApplicationBootstrap()).resolves.toBeUndefined();
      expect(discovery.getControllers).not.toHaveBeenCalled();
      expect(repository.findExistingModuleIds).not.toHaveBeenCalled();
    }
  });

  it("unsectioned session-guarded POST → throws naming the route", async () => {
    const { audit } = buildAudit({ controllers: [SectionedController, UnsectionedWriteController], enforce: true });

    await expect(audit.onApplicationBootstrap()).rejects.toThrow(
      "POST /unsectioned/things (UnsectionedWriteController.createThing)",
    );
  });

  it("unsectioned GET → passes", async () => {
    const { audit } = buildAudit({ controllers: [SectionedController, UnsectionedReadController], enforce: true });

    await expect(audit.onApplicationBootstrap()).resolves.toBeUndefined();
  });

  it("route with no session guard → ignored", async () => {
    const { audit } = buildAudit({ controllers: [PublicController], enforce: true });

    await expect(audit.onApplicationBootstrap()).resolves.toBeUndefined();
    const labels = audit.collectRoutes().map((r) => r.label);
    expect(labels).toEqual(["POST /public/tracked (PublicController.tracked)"]);
  });

  it("section id with no Module node → throws", async () => {
    const { audit } = buildAudit({ controllers: [SectionedController, MissingSectionController], enforce: true });

    await expect(audit.onApplicationBootstrap()).rejects.toThrow(MISSING_SECTION);
  });
});
