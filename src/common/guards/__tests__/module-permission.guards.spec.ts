import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Mocked } from "vitest";
import { ExecutionContext, ForbiddenException, HttpException } from "@nestjs/common";
import { Test } from "@nestjs/testing";
import { Reflector } from "@nestjs/core";
import { ClsService } from "nestjs-cls";
import { Neo4jService } from "../../../core/neo4j/services/neo4j.service";
import { ModulePermissionGate } from "../../../foundations/rbac/services/module-permission.gate";
import { SYSTEM_ROLES } from "../../tokens";
import { AdminJwtAuthGuard } from "../jwt.auth.admin.guard";
import { JwtAuthGuard } from "../jwt.auth.guard";
import { OptionalJwtAuthGuard } from "../jwt.auth.optional.guard";

const MOCK_USER = { userId: "user-1", companyId: "company-1", roles: ["editor"] };

const createContext = (options: { authorization?: string; user?: any }): Mocked<ExecutionContext> => {
  const request = {
    method: "POST",
    headers: { authorization: options.authorization },
    user: options.user,
  };
  return {
    switchToHttp: vi
      .fn()
      .mockReturnValue({ getRequest: () => request, getResponse: () => ({}), getNext: () => vi.fn() }),
    getHandler: vi.fn().mockReturnValue(vi.fn()),
    getClass: vi.fn().mockReturnValue(vi.fn()),
    getArgs: vi.fn().mockReturnValue([]),
    getArgByIndex: vi.fn().mockReturnValue(null),
    switchToRpc: vi.fn().mockReturnValue({ getData: vi.fn(), getContext: vi.fn() }),
    switchToWs: vi.fn().mockReturnValue({ getData: vi.fn(), getClient: vi.fn(), getPattern: vi.fn() }),
    getType: vi.fn().mockReturnValue("http"),
  };
};

const GUARDS = [
  { name: "JwtAuthGuard", type: JwtAuthGuard },
  { name: "AdminJwtAuthGuard", type: AdminJwtAuthGuard },
  { name: "OptionalJwtAuthGuard", type: OptionalJwtAuthGuard },
] as const;

describe.each(GUARDS)("$name → ModulePermissionGate", ({ type }) => {
  // The passport `AuthGuard("jwt")` mixin prototype, shared by the three guards:
  // stubbed so `super.canActivate` reports the authentication outcome directly.
  const passportPrototype = Object.getPrototypeOf(type.prototype);
  let superCanActivate: any;
  let gate: { assert: ReturnType<typeof vi.fn> };

  const buildGuard = async (withGate = true): Promise<any> => {
    const providers: any[] = [
      type,
      { provide: ClsService, useValue: { set: vi.fn(), get: vi.fn(), isActive: vi.fn(() => true) } },
      { provide: Reflector, useValue: { get: vi.fn(), getAllAndOverride: vi.fn() } },
      { provide: Neo4jService, useValue: {} },
      { provide: SYSTEM_ROLES, useValue: { Administrator: "admin-role" } },
    ];
    if (withGate) providers.push({ provide: ModulePermissionGate, useValue: gate });
    const module = await Test.createTestingModule({ providers }).compile();
    return module.get(type);
  };

  beforeEach(() => {
    gate = { assert: vi.fn().mockResolvedValue(undefined) };
    superCanActivate = vi.spyOn(passportPrototype, "canActivate").mockResolvedValue(true);
  });

  afterEach(() => {
    superCanActivate.mockRestore();
    vi.clearAllMocks();
  });

  it("calls gate.assert once after a successful authentication", async () => {
    const guard = await buildGuard();
    const context = createContext({ authorization: "Bearer token", user: MOCK_USER });
    const request = context.switchToHttp().getRequest();

    await expect(guard.canActivate(context)).resolves.toBe(true);

    expect(gate.assert).toHaveBeenCalledTimes(1);
    expect(gate.assert).toHaveBeenCalledWith({ request, context });
  });

  it("propagates the gate's 403", async () => {
    gate.assert.mockRejectedValue(new ForbiddenException());
    const guard = await buildGuard();
    const context = createContext({ authorization: "Bearer token", user: MOCK_USER });

    await expect(guard.canActivate(context)).rejects.toBeInstanceOf(ForbiddenException);
  });

  it("does not call gate.assert after a failed authentication", async () => {
    superCanActivate.mockRejectedValue(new HttpException("Unauthorised", 401));
    const guard = await buildGuard();
    const context = createContext({ authorization: "Bearer bad-token", user: undefined });

    await expect(guard.canActivate(context)).rejects.toBeInstanceOf(HttpException);
    expect(gate.assert).not.toHaveBeenCalled();
  });

  it("does not call gate.assert when no user was attached", async () => {
    const guard = await buildGuard();
    const context = createContext({ authorization: "Bearer token", user: undefined });

    await guard.canActivate(context);

    expect(gate.assert).not.toHaveBeenCalled();
  });

  it("authenticates as before when no gate is registered", async () => {
    const guard = await buildGuard(false);
    const context = createContext({ authorization: "Bearer token", user: MOCK_USER });

    await expect(guard.canActivate(context)).resolves.toBe(true);
  });
});
