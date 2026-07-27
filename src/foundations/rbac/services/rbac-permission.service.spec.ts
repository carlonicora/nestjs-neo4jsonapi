import { describe, it, expect, beforeEach, vi } from "vitest";
import { RbacPermissionService } from "./rbac-permission.service";

describe("RbacPermissionService", () => {
  let service: RbacPermissionService;
  const repo = { findEffectivePermissionsForUser: vi.fn() };

  beforeEach(() => {
    repo.findEffectivePermissionsForUser.mockReset();
    service = new RbacPermissionService(repo as any);
  });

  it("allows when the effective flag for the action is true", async () => {
    repo.findEffectivePermissionsForUser.mockResolvedValue(
      new Map([["mod-orders", { read: true, create: true, update: false, delete: false }]]),
    );
    await expect(service.can({ userId: "u1", moduleId: "mod-orders", action: "create" })).resolves.toBe(true);
    await expect(service.can({ userId: "u1", moduleId: "mod-orders", action: "update" })).resolves.toBe(false);
  });

  it("denies unknown modules", async () => {
    repo.findEffectivePermissionsForUser.mockResolvedValue(new Map());
    await expect(service.can({ userId: "u1", moduleId: "nope", action: "read" })).resolves.toBe(false);
  });
});
