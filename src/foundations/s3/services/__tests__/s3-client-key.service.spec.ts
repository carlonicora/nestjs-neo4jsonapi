import { describe, it, expect, vi } from "vitest";
import type { Mocked } from "vitest";
import { BadRequestException, ForbiddenException } from "@nestjs/common";
import { Test } from "@nestjs/testing";
import { ClsService } from "nestjs-cls";
import {
  S3_KEY_ACCESS_POLICY,
  S3KeyAccessParams,
  S3KeyAccessPolicy,
} from "../../../../common/interfaces/s3.key-access.policy.interface";
import { S3ClientKeyService } from "../s3-client-key.service";

const OWN = "company-own";
const OTHER = "company-other";

/** Same rule as an app policy: `companies/<caller company>/…`, platform Administrator anywhere under companies/. */
function companyPrefixPolicy(): Mocked<S3KeyAccessPolicy> {
  return {
    canAccess: vi.fn((params: S3KeyAccessParams) => {
      const [root, companyId, ...rest] = params.key.split("/");
      if (root !== "companies" || rest.length === 0) return false;
      if (params.roles.includes("platform-admin")) return true;
      return !!params.companyId && companyId === params.companyId;
    }),
  } as Mocked<S3KeyAccessPolicy>;
}

async function build(params: { policy?: S3KeyAccessPolicy; cls?: Record<string, unknown> }) {
  const cls = params.cls ?? { userId: "user-1", companyId: OWN, roles: [] };
  const module = await Test.createTestingModule({
    providers: [
      S3ClientKeyService,
      { provide: ClsService, useValue: { get: vi.fn((key: string) => cls[key]) } },
      ...(params.policy ? [{ provide: S3_KEY_ACCESS_POLICY, useValue: params.policy }] : []),
    ],
  }).compile();
  return module.get(S3ClientKeyService);
}

describe("S3ClientKeyService.assertClientKey", () => {
  it("allows a key under the caller's own company", async () => {
    const policy = companyPrefixPolicy();
    const service = await build({ policy });

    await expect(service.assertClientKey({ key: `companies/${OWN}/artworks/a1/a1.png` })).resolves.toBeUndefined();
    expect(policy.canAccess).toHaveBeenCalledWith({
      key: `companies/${OWN}/artworks/a1/a1.png`,
      action: "download",
      isPublic: false,
      userId: "user-1",
      companyId: OWN,
      roles: [],
    });
  });

  it("passes the requested action to the policy", async () => {
    const policy = companyPrefixPolicy();
    const service = await build({ policy });

    await service.assertClientKey({ key: `companies/${OWN}/audio/tracks/t1/t1.mp3`, action: "upload" });
    expect(policy.canAccess).toHaveBeenCalledWith(expect.objectContaining({ action: "upload" }));
  });

  it("refuses another company's key (403)", async () => {
    const service = await build({ policy: companyPrefixPolicy() });

    await expect(service.assertClientKey({ key: `companies/${OTHER}/artworks/a1/a1.png` })).rejects.toThrow(
      ForbiddenException,
    );
  });

  it.each(["/companies/x/artworks/a1/a1.png", `companies/${OWN}/../${OTHER}/artworks/a1/a1.png`, "   "])(
    "refuses a malformed key %j (400)",
    async (key) => {
      const policy = companyPrefixPolicy();
      const service = await build({ policy });

      await expect(service.assertClientKey({ key })).rejects.toThrow(BadRequestException);
      expect(policy.canAccess).not.toHaveBeenCalled();
    },
  );

  it("refuses when the caller has no CLS company (403)", async () => {
    const service = await build({ policy: companyPrefixPolicy(), cls: { userId: "user-1", roles: [] } });

    await expect(service.assertClientKey({ key: `companies/${OWN}/artworks/a1/a1.png` })).rejects.toThrow(
      ForbiddenException,
    );
  });

  it("allows every value when no policy is bound", async () => {
    const service = await build({});

    await expect(service.assertClientKey({ key: `companies/${OTHER}/artworks/a1/a1.png` })).resolves.toBeUndefined();
    await expect(service.assertClientKey({ key: "/etc/passwd" })).resolves.toBeUndefined();
  });

  it.each([undefined, null, ""])("lets an absent value %j through", async (key) => {
    const policy = companyPrefixPolicy();
    const service = await build({ policy });

    await expect(service.assertClientKey({ key })).resolves.toBeUndefined();
    expect(policy.canAccess).not.toHaveBeenCalled();
  });

  it("lets an absolute http(s) URL through (not an S3 key)", async () => {
    const policy = companyPrefixPolicy();
    const service = await build({ policy });

    await expect(
      service.assertClientKey({ key: "https://api.example.test/s3/objects/token" }),
    ).resolves.toBeUndefined();
    expect(policy.canAccess).not.toHaveBeenCalled();
  });

  describe("folder", () => {
    it("allows a key in the field's own folder", async () => {
      const service = await build({ policy: companyPrefixPolicy() });

      await expect(
        service.assertClientKey({ key: `companies/${OWN}/users/u1/u1.123.png`, folder: "users" }),
      ).resolves.toBeUndefined();
    });

    it("refuses an own-company key in another folder (403)", async () => {
      const policy = companyPrefixPolicy();
      const service = await build({ policy });

      await expect(
        service.assertClientKey({ key: `companies/${OWN}/exports/e1/export.zip`, folder: "users" }),
      ).rejects.toThrow(ForbiddenException);
      expect(policy.canAccess).not.toHaveBeenCalled();
    });

    it("lets a platform administrator reference another company's logo", async () => {
      const service = await build({
        policy: companyPrefixPolicy(),
        cls: { userId: "admin", companyId: OWN, roles: ["platform-admin"] },
      });

      await expect(
        service.assertClientKey({ key: `companies/${OTHER}/companies/${OTHER}/${OTHER}.1.png`, folder: "companies" }),
      ).resolves.toBeUndefined();
    });
  });
});

describe("S3ClientKeyService.assertKeyAccess", () => {
  it("refuses a malformed key (400) even with no policy bound", async () => {
    const service = await build({});

    await expect(service.assertKeyAccess({ key: "a/../b", action: "upload", isPublic: false })).rejects.toThrow(
      BadRequestException,
    );
  });

  it("reads the string query value 'true' as isPublic", async () => {
    const policy = companyPrefixPolicy();
    const service = await build({ policy });

    await service.assertKeyAccess({ key: `companies/${OWN}/users/u1/u1.png`, action: "upload", isPublic: "true" });
    expect(policy.canAccess).toHaveBeenCalledWith(expect.objectContaining({ isPublic: true, action: "upload" }));
  });

  it("refuses a policy refusal (403)", async () => {
    const service = await build({ policy: companyPrefixPolicy() });

    await expect(
      service.assertKeyAccess({ key: `companies/${OTHER}/users/u1/u1.png`, action: "delete", isPublic: false }),
    ).rejects.toThrow(new ForbiddenException("You cannot access this file."));
  });
});
