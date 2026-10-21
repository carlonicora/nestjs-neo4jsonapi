import { BadRequestException, ForbiddenException, Inject, Injectable, Optional } from "@nestjs/common";
import { ClsService } from "nestjs-cls";
import {
  isWellFormedS3Key,
  S3_KEY_ACCESS_POLICY,
  S3KeyAccessPolicy,
  S3KeyAction,
} from "../../../common/interfaces/s3.key-access.policy.interface";

/**
 * Runs the bound `S3_KEY_ACCESS_POLICY` on an object key for the current
 * caller (`userId`, `companyId` and `roles` from the request CLS context, the
 * same values the repositories scope by).
 *
 * Two entry points:
 *
 * - `assertKeyAccess` — the `/s3` routes (presign, sign, delete). A malformed
 *   key is refused (400) whether or not a policy is bound.
 * - `assertClientKey` — a key the CLIENT sent in a request body (an avatar, a
 *   logo, an uploaded file the entity will point at), run by a service before
 *   the key is stored or read server-side.
 *
 * When no policy is bound, `assertClientKey` allows every value, exactly as
 * before the check existed: an application that wants body keys checked binds
 * `S3_KEY_ACCESS_POLICY`.
 */
@Injectable()
export class S3ClientKeyService {
  constructor(
    private readonly clsService: ClsService,
    @Optional()
    @Inject(S3_KEY_ACCESS_POLICY)
    private readonly keyPolicy?: S3KeyAccessPolicy,
  ) {}

  /**
   * Rejects a malformed key (400) whether or not a policy is bound, then asks
   * the bound policy, if any, and rejects a refusal (403).
   */
  async assertKeyAccess(params: {
    key: unknown;
    action: S3KeyAction;
    isPublic: boolean | string | undefined;
  }): Promise<void> {
    if (!isWellFormedS3Key(params.key)) throw new BadRequestException("Invalid S3 key");

    if (!this.keyPolicy) return;

    const allowed = await this._canAccess({
      key: params.key,
      action: params.action,
      // Query params arrive as strings: "true" is the only truthy value the clients send.
      isPublic: params.isPublic === true || params.isPublic === "true",
    });

    if (!allowed) throw new ForbiddenException("You cannot access this file.");
  }

  /**
   * Service-side check for a key the CLIENT sent in a request body (a
   * document url, an avatar, a logo, an uploaded file…), run before the key is
   * stored or read. The stored key is later signed for whoever reads the
   * entity, so a key the caller may not download must never be accepted.
   *
   * Absent values pass (nothing to check). An absolute http(s) URL is not an
   * S3 key and passes untouched: the callers already branch on it, or store
   * it as a literal link (the web user editor sends back the signed avatar
   * URL it was given).
   *
   * No policy bound: every value passes, as before (see the class comment).
   *
   * Otherwise a malformed key (`isWellFormedS3Key`) is refused with a 400,
   * and the bound policy decides with `action` (default `download`, since the
   * stored key is signed for every reader) and `isPublic: false`; a refusal
   * is a 403.
   *
   * `folder` is set by the avatar / image / logo fields: the key must then sit
   * in that field's own folder, `companies/<cid>/<folder>/…` (`users` for the
   * avatar, `companies` for the logo), so such a field cannot point at another
   * kind of file (a recording, an export) of the same company. No
   * Administrator bypass on the folder; the policy still decides the company.
   */
  async assertClientKey(params: {
    key: string | null | undefined;
    action?: S3KeyAction;
    folder?: string;
  }): Promise<void> {
    const key = params.key;
    if (key === undefined || key === null || key === "") return;
    if (/^https?:\/\//i.test(key)) return;

    if (!this.keyPolicy) return;

    if (!isWellFormedS3Key(key)) throw new BadRequestException("Invalid S3 key");

    if (params.folder !== undefined) {
      const segments = key.split("/");
      if (segments[0] !== "companies" || segments[2] !== params.folder || segments.length < 5)
        throw new ForbiddenException("You cannot reference this file.");
    }

    const allowed = await this._canAccess({ key, action: params.action ?? "download", isPublic: false });

    if (!allowed) throw new ForbiddenException("You cannot reference this file.");
  }

  private async _canAccess(params: { key: string; action: S3KeyAction; isPublic: boolean }): Promise<boolean> {
    return await this.keyPolicy.canAccess({
      key: params.key,
      action: params.action,
      isPublic: params.isPublic,
      userId: this.clsService.get("userId"),
      companyId: this.clsService.get("companyId"),
      roles: this.clsService.get("roles") ?? [],
    });
  }
}
