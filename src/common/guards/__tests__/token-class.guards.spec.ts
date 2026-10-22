import { vi, describe, it, expect, beforeEach } from "vitest";
import { ExecutionContext, HttpException } from "@nestjs/common";
import { Reflector } from "@nestjs/core";
import { ClsService } from "nestjs-cls";
import { Roles } from "../../decorators/roles.decorator";
import { AllowedTokenScopes, TOKEN_SCOPES_KEY } from "../../decorators/token-scopes.decorator";
import { SystemRoles } from "../../constants/system.roles";
import { JwtAuthGuard } from "../jwt.auth.guard";
import { AdminJwtAuthGuard } from "../jwt.auth.admin.guard";
import { OptionalJwtAuthGuard } from "../jwt.auth.optional.guard";
import { AnyScopeAuthGuard } from "../jwt.auth.any-scope.guard";
import { isAcceptedScopedPayload, isSessionPayload, resolveSessionCompanyId } from "../session.token";
import { AuthCompanyController } from "../../../foundations/auth/controllers/auth.company.controller";

const ADMIN = SystemRoles.Administrator;
const USER_ID = "660e8400-e29b-41d4-a716-446655440001";
const COMPANY_ID = "550e8400-e29b-41d4-a716-446655440000";
const OTHER_COMPANY_ID = "550e8400-e29b-41d4-a716-446655440099";

const SESSION = { userId: USER_ID, companyId: COMPANY_ID, roles: ["editor"], features: [], userName: "U" };

/** Every non-session payload a key signed with `jwt.secret` can carry. */
const NON_SESSION_PAYLOADS: Array<[string, unknown]> = [
  ["pending-2FA token", { userId: USER_ID, pendingId: "p1", pending: true, type: "pending_2fa" }],
  ["company-selection token", { userId: USER_ID, scope: "company-selection" }],
  ["invitation-selection token", { userId: USER_ID, scope: "invitation-selection" }],
  ["portal Person token", { personEmail: "client@example.com", companyId: COMPANY_ID }],
  ["portal token with userId and roles grafted", { ...SESSION, personEmail: "client@example.com" }],
  ["session-shaped token carrying a scope", { ...SESSION, scope: "company-selection" }],
  ["session-shaped token carrying a type", { ...SESSION, type: "pending_2fa" }],
  ["session-shaped token carrying pending", { ...SESSION, pending: true }],
  ["session-shaped token carrying pendingId", { ...SESSION, pendingId: "p1" }],
  ["token without roles", { userId: USER_ID, companyId: COMPANY_ID }],
  ["token with non-array roles", { userId: USER_ID, companyId: COMPANY_ID, roles: "editor" }],
  ["token with non-string roles", { userId: USER_ID, companyId: COMPANY_ID, roles: [1] }],
  ["token without userId", { companyId: COMPANY_ID, roles: ["editor"] }],
  ["token with empty userId", { userId: "", companyId: COMPANY_ID, roles: ["editor"] }],
  ["token with a non-string userId", { userId: 42, companyId: COMPANY_ID, roles: ["editor"] }],
  ["token with an object companyId", { userId: USER_ID, companyId: { id: COMPANY_ID }, roles: ["editor"] }],
];

class AnyController {
  plain() {}
}

const createContext = (params: {
  headers?: Record<string, string | undefined>;
  handler?: (...args: any[]) => any;
  cls?: new (...args: any[]) => any;
}): ExecutionContext => {
  const request = {
    headers: { authorization: "Bearer signed-token", "x-language": "en", ...(params.headers ?? {}) },
    ip: "127.0.0.1",
  };
  return {
    switchToHttp: () => ({ getRequest: () => request, getResponse: () => ({}), getNext: () => vi.fn() }),
    getHandler: () => params.handler ?? AnyController.prototype.plain,
    getClass: () => params.cls ?? AnyController,
    getArgs: () => [],
    getArgByIndex: () => null,
    switchToRpc: () => ({}) as any,
    switchToWs: () => ({}) as any,
    getType: () => "http" as const,
  } as ExecutionContext;
};

const createCls = () => ({ set: vi.fn(), get: vi.fn() });

const expectUnauthorised = (fn: () => unknown) => {
  try {
    fn();
  } catch (error) {
    expect(error).toBeInstanceOf(HttpException);
    expect((error as HttpException).getStatus()).toBe(401);
    return;
  }
  throw new Error("expected a 401");
};

describe("session.token helpers", () => {
  it.each(NON_SESSION_PAYLOADS)("isSessionPayload refuses a %s", (_, payload) => {
    expect(isSessionPayload(payload)).toBe(false);
  });

  it.each([null, undefined, "a-string", 42])("isSessionPayload refuses %s", (payload) => {
    expect(isSessionPayload(payload)).toBe(false);
  });

  it("isSessionPayload admits a full session, with or without a company", () => {
    expect(isSessionPayload(SESSION)).toBe(true);
    expect(isSessionPayload({ ...SESSION, companyId: undefined })).toBe(true);
    expect(isSessionPayload({ ...SESSION, companyId: null })).toBe(true);
  });

  it("isAcceptedScopedPayload refuses a pending-2FA token whatever the allowlist", () => {
    const pending = { userId: USER_ID, pendingId: "p1", pending: true, type: "pending_2fa" };
    expect(isAcceptedScopedPayload(pending, ["company-selection", "invitation-selection"])).toBe(false);
  });

  it("isAcceptedScopedPayload refuses a scope outside the allowlist, and every scope with an empty allowlist", () => {
    expect(isAcceptedScopedPayload({ userId: USER_ID, scope: "invitation-selection" }, ["company-selection"])).toBe(
      false,
    );
    expect(isAcceptedScopedPayload({ userId: USER_ID, scope: "company-selection" }, [])).toBe(false);
  });

  it("isAcceptedScopedPayload refuses an allowed scope that also carries pending, type or personEmail", () => {
    for (const extra of [{ pending: true }, { type: "pending_2fa" }, { personEmail: "a@b.c" }, { pendingId: "p" }])
      expect(
        isAcceptedScopedPayload({ userId: USER_ID, scope: "company-selection", ...extra }, ["company-selection"]),
      ).toBe(false);
  });

  it("isAcceptedScopedPayload refuses a selection token without a userId", () => {
    expect(isAcceptedScopedPayload({ scope: "company-selection" }, ["company-selection"])).toBe(false);
  });

  it("isAcceptedScopedPayload admits the allowed scope and a full session", () => {
    expect(isAcceptedScopedPayload({ userId: USER_ID, scope: "company-selection" }, ["company-selection"])).toBe(true);
    expect(isAcceptedScopedPayload(SESSION, [])).toBe(true);
  });

  it("resolveSessionCompanyId keeps the token's company over a different header", () => {
    expect(resolveSessionCompanyId({ payload: SESSION, headerCompanyId: OTHER_COMPANY_ID })).toBe(COMPANY_ID);
  });

  it("resolveSessionCompanyId refuses a non-admin without a company, with or without a header", () => {
    const noCompany = { ...SESSION, companyId: undefined };
    expectUnauthorised(() => resolveSessionCompanyId({ payload: noCompany, headerCompanyId: OTHER_COMPANY_ID }));
    expectUnauthorised(() => resolveSessionCompanyId({ payload: noCompany, headerCompanyId: undefined }));
  });

  it("resolveSessionCompanyId refuses a CompanyAdministrator without a company that names one", () => {
    const companyAdmin = { ...SESSION, companyId: undefined, roles: [SystemRoles.CompanyAdministrator] };
    expectUnauthorised(() => resolveSessionCompanyId({ payload: companyAdmin, headerCompanyId: OTHER_COMPANY_ID }));
  });

  it("resolveSessionCompanyId lets a system Administrator without a company pick one, or act without one", () => {
    const admin = { ...SESSION, companyId: undefined, roles: [ADMIN] };
    expect(resolveSessionCompanyId({ payload: admin, headerCompanyId: OTHER_COMPANY_ID })).toBe(OTHER_COMPANY_ID);
    expect(resolveSessionCompanyId({ payload: admin, headerCompanyId: undefined })).toBeUndefined();
  });

  it("resolveSessionCompanyId uses the injected administrator role, not a different one", () => {
    const admin = { ...SESSION, companyId: undefined, roles: [ADMIN] };
    expectUnauthorised(() =>
      resolveSessionCompanyId({ payload: admin, headerCompanyId: OTHER_COMPANY_ID, administratorRole: "app-admin" }),
    );
  });
});

type SessionGuard = JwtAuthGuard | AdminJwtAuthGuard | OptionalJwtAuthGuard;

const SESSION_GUARDS: Array<[string, (cls: ClsService, reflector: Reflector) => SessionGuard]> = [
  ["JwtAuthGuard", (cls, reflector) => new JwtAuthGuard(cls, reflector, {} as any, { Administrator: ADMIN })],
  ["AdminJwtAuthGuard", (cls, reflector) => new AdminJwtAuthGuard(cls, reflector, {} as any, { Administrator: ADMIN })],
  ["OptionalJwtAuthGuard", (cls, reflector) => new OptionalJwtAuthGuard(cls, reflector, { Administrator: ADMIN })],
];

describe.each(SESSION_GUARDS)("%s token class", (name, build) => {
  let cls: ReturnType<typeof createCls>;
  let guard: SessionGuard;

  // AdminJwtAuthGuard requires the system Administrator on every route.
  const sessionFor = (overrides: Record<string, unknown> = {}) =>
    name === "AdminJwtAuthGuard" ? { ...SESSION, roles: [ADMIN], ...overrides } : { ...SESSION, ...overrides };

  beforeEach(() => {
    cls = createCls();
    guard = build(cls as unknown as ClsService, new Reflector());
  });

  it.each(NON_SESSION_PAYLOADS)("refuses a %s with 401 and writes nothing to CLS", (_, payload) => {
    expectUnauthorised(() => guard.handleRequest(null, payload, null, createContext({})));
    expect(cls.set).not.toHaveBeenCalled();
  });

  it("refuses a non-admin session without a company that names one in x-companyid", () => {
    if (name === "AdminJwtAuthGuard") return; // every caller of this guard is an Administrator
    const context = createContext({ headers: { "x-companyid": OTHER_COMPANY_ID } });
    expectUnauthorised(() => guard.handleRequest(null, sessionFor({ companyId: undefined }), null, context));
    expect(cls.set).not.toHaveBeenCalledWith("companyId", expect.anything());
  });

  it("refuses a non-admin session without a company and without a header", () => {
    if (name === "AdminJwtAuthGuard") return;
    expectUnauthorised(() => guard.handleRequest(null, sessionFor({ companyId: undefined }), null, createContext({})));
  });

  it("pins companyId to the token's company over a different x-companyid header", () => {
    const context = createContext({ headers: { "x-companyid": OTHER_COMPANY_ID } });
    guard.handleRequest(null, sessionFor(), null, context);
    expect(cls.set).toHaveBeenCalledWith("companyId", COMPANY_ID);
    expect(cls.set).not.toHaveBeenCalledWith("companyId", OTHER_COMPANY_ID);
  });

  it("honours x-companyid for a system Administrator token without a company", () => {
    const context = createContext({ headers: { "x-companyid": OTHER_COMPANY_ID } });
    guard.handleRequest(null, sessionFor({ companyId: undefined, roles: [ADMIN] }), null, context);
    expect(cls.set).toHaveBeenCalledWith("companyId", OTHER_COMPANY_ID);
  });

  it("admits a full session", () => {
    const user = sessionFor();
    expect(guard.handleRequest(null, user, null, createContext({}))).toBe(user);
    expect(cls.set).toHaveBeenCalledWith("userId", USER_ID);
  });
});

@Roles("class-role")
class ClassRolesController {
  inherits() {}

  @Roles("handler-role")
  overrides() {}
}

describe.each(SESSION_GUARDS)("%s reads @Roles from handler AND class", (name, build) => {
  let cls: ReturnType<typeof createCls>;
  let guard: SessionGuard;

  beforeEach(() => {
    cls = createCls();
    guard = build(cls as unknown as ClsService, new Reflector());
  });

  const inheritsContext = () =>
    createContext({ handler: ClassRolesController.prototype.inherits, cls: ClassRolesController });
  const overridesContext = () =>
    createContext({ handler: ClassRolesController.prototype.overrides, cls: ClassRolesController });

  it("refuses a user without the class-level role on a handler that declares none", () => {
    expectUnauthorised(() => guard.handleRequest(null, { ...SESSION, roles: ["editor"] }, null, inheritsContext()));
  });

  it("admits a user holding the class-level role", () => {
    if (name === "AdminJwtAuthGuard") return; // that guard always demands the Administrator as well
    const user = { ...SESSION, roles: ["class-role"] };
    expect(guard.handleRequest(null, user, null, inheritsContext())).toBe(user);
  });

  it("lets the handler-level @Roles override the class-level one", () => {
    expectUnauthorised(() =>
      guard.handleRequest(null, { ...SESSION, roles: ["class-role"] }, null, overridesContext()),
    );
    if (name === "AdminJwtAuthGuard") return;
    const user = { ...SESSION, roles: ["handler-role"] };
    expect(guard.handleRequest(null, user, null, overridesContext())).toBe(user);
  });

  it("never writes the administrator role into the decorator metadata", () => {
    guard.handleRequest(null, { ...SESSION, roles: [ADMIN] }, null, inheritsContext());
    guard.handleRequest(null, { ...SESSION, roles: [ADMIN] }, null, overridesContext());
    const reflector = new Reflector();
    expect(reflector.get("roles", ClassRolesController)).toEqual(["class-role"]);
    expect(reflector.get("roles", ClassRolesController.prototype.overrides)).toEqual(["handler-role"]);
  });
});

class ScopedController {
  sessionOnly() {}

  @AllowedTokenScopes("company-selection")
  companySelection() {}

  @AllowedTokenScopes("invitation-selection")
  invitationSelection() {}
}

describe("AnyScopeAuthGuard scope allowlist", () => {
  let cls: ReturnType<typeof createCls>;
  let guard: AnyScopeAuthGuard;

  const contextFor = (handler: keyof ScopedController) =>
    createContext({ handler: ScopedController.prototype[handler], cls: ScopedController });

  beforeEach(() => {
    cls = createCls();
    guard = new AnyScopeAuthGuard(cls as unknown as ClsService, new Reflector());
  });

  it("refuses a pending-2FA token with 401 on a company-selection route and writes nothing to CLS", () => {
    const pending = { userId: USER_ID, pendingId: "p1", pending: true, type: "pending_2fa" };
    expectUnauthorised(() => guard.handleRequest(null, pending, null, contextFor("companySelection")));
    expect(cls.set).not.toHaveBeenCalled();
  });

  it("refuses a portal Person token", () => {
    const portal = { personEmail: "client@example.com", companyId: COMPANY_ID };
    expectUnauthorised(() => guard.handleRequest(null, portal, null, contextFor("companySelection")));
  });

  it("refuses an invitation-selection token on a company-selection route", () => {
    const token = { userId: USER_ID, scope: "invitation-selection" };
    expectUnauthorised(() => guard.handleRequest(null, token, null, contextFor("companySelection")));
  });

  it("refuses a company-selection token on an invitation-selection route", () => {
    const token = { userId: USER_ID, scope: "company-selection" };
    expectUnauthorised(() => guard.handleRequest(null, token, null, contextFor("invitationSelection")));
  });

  it("refuses every selection token on a route that lists no scope", () => {
    for (const scope of ["company-selection", "invitation-selection"])
      expectUnauthorised(() => guard.handleRequest(null, { userId: USER_ID, scope }, null, contextFor("sessionOnly")));
  });

  it("refuses an allowed scope that also carries pending", () => {
    const token = { userId: USER_ID, scope: "company-selection", pending: true };
    expectUnauthorised(() => guard.handleRequest(null, token, null, contextFor("companySelection")));
  });

  it("admits the listed scope and publishes userId and token on CLS", () => {
    const token = { userId: USER_ID, scope: "company-selection" };
    expect(guard.handleRequest(null, token, null, contextFor("companySelection"))).toBe(token);
    expect(cls.set).toHaveBeenCalledWith("userId", USER_ID);
    expect(cls.set).toHaveBeenCalledWith("token", "signed-token");
  });

  it("admits the invitation-selection scope where it is listed", () => {
    const token = { userId: USER_ID, scope: "invitation-selection" };
    expect(guard.handleRequest(null, token, null, contextFor("invitationSelection"))).toBe(token);
  });

  it("admits a full session on any route", () => {
    expect(guard.handleRequest(null, SESSION, null, contextFor("sessionOnly"))).toBe(SESSION);
  });
});

describe("AuthCompanyController scope allowlist", () => {
  it.each(["findCompanies", "selectCompany"] as const)("%s lists company-selection only", (method) => {
    const handler = AuthCompanyController.prototype[method];
    expect(new Reflector().get(TOKEN_SCOPES_KEY, handler)).toEqual(["company-selection"]);
  });
});
