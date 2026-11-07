import { ConflictException, ForbiddenException, HttpException, HttpStatus, Injectable } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { ModuleRef } from "@nestjs/core";
import { createHash, randomBytes } from "crypto";
import { ClsService } from "nestjs-cls";
import { BaseConfigInterface, ConfigApiInterface, ConfigRedisInterface } from "../../../config/interfaces";
import { ConfigDiscordInterface } from "../../../config/interfaces/config.discord.interface";
import { JsonApiSingleDocument } from "../../../core/jsonapi/interfaces/jsonapi.document.interface";
import { JsonApiService } from "../../../core/jsonapi/services/jsonapi.service";
import { RedisLockService } from "../../../core/redis/services/redis.lock.service";
import { DiscordUserRepository } from "../../discord-user/repositories/discord-user.repository";
import { DiscordUserService } from "../../discord-user/services/discord-user.service";
import { DiscordConnectConfirmationDescriptor, DiscordConnectResult } from "../entities/discord-connect-confirmation";
import { DiscordConnectIntentDescriptor } from "../entities/discord-connect-intent";
import { discordConnectIntentMeta } from "../entities/discord-connect-intent.meta";
import { resolveDiscordConnectPolicy } from "../utils/resolve-discord-connect-policy";
import { sanitiseReturnPath } from "../utils/sanitise-return-path";
// Direct file import, NOT the `..` barrel (same DI-metadata cycle as auth.discord.service.ts).
import { AuthDiscordService } from "./auth.discord.service";
import { DiscordConnectIntentStore } from "./discord-connect-intent.store";

/** Life of an intent and of its browser cookie. */
const INTENT_TTL_SECONDS = 600;
/** Life of the per-Discord-id link lock. */
const LINK_LOCK_TTL_SECONDS = 30;

/**
 * Starts and confirms a Discord connect (linking a Discord account to the signed-in user).
 *
 * The intent lives in Redis, not in Neo4j, so this is a plain service, not an AbstractService:
 * there is no repository for the base class. Documents are built with JsonApiService.buildSingle.
 */
@Injectable()
export class DiscordConnectIntentService {
  constructor(
    private readonly store: DiscordConnectIntentStore,
    private readonly clsService: ClsService,
    private readonly config: ConfigService<BaseConfigInterface>,
    private readonly moduleRef: ModuleRef,
    private readonly discordUserRepository: DiscordUserRepository,
    private readonly discordUserService: DiscordUserService,
    private readonly redisLockService: RedisLockService,
    private readonly jsonApiService: JsonApiService,
    private readonly authDiscordService: AuthDiscordService,
  ) {}

  /**
   * Creates the intent for the CLS user and the browser cookie that binds it to this browser.
   * The controller sets `cookie` as the `Set-Cookie` header.
   *
   * @throws ForbiddenException with no company in CLS (platform Administrator) or when the app policy refuses
   * @throws HttpException 501 when Discord is not configured
   * @throws ConflictException when the user already has Discord or the id is already in use
   */
  async create(params: {
    id: string;
    returnPath: string;
  }): Promise<{ document: JsonApiSingleDocument; cookie: string }> {
    const companyId = this.clsService.get("companyId");
    const userId = this.clsService.get("userId");
    if (!companyId || !userId) throw new ForbiddenException("Discord connect is not available for this account");

    const policy = resolveDiscordConnectPolicy(this.moduleRef);
    if (policy && !(await policy.canConnect({ userId, companyId }))) {
      throw new ForbiddenException("Discord connect is not available for this account");
    }

    const discord = this.config.get<ConfigDiscordInterface>("discord");
    if (!discord?.clientId || !discord?.clientSecret) {
      throw new HttpException("Discord connect is not available", HttpStatus.NOT_IMPLEMENTED);
    }

    if (await this.discordUserRepository.findByUserId({ userId })) {
      throw new ConflictException("This account is already connected to Discord");
    }

    const returnPath = sanitiseReturnPath(params.returnPath);
    const browserKey = randomBytes(32).toString("base64url");

    const created = await this.store.create({
      code: params.id,
      userId,
      returnPath,
      browserKeyHash: createHash("sha256").update(browserKey).digest("hex"),
    });
    if (!created) throw new ConflictException("This Discord connect already exists");

    const authorizeUrl = `${this.config.get<ConfigApiInterface>("api").url}${discordConnectIntentMeta.endpoint}/${params.id}/authorize`;

    const document = await this.jsonApiService.buildSingle(DiscordConnectIntentDescriptor.model, {
      id: params.id,
      returnPath,
      authorizeUrl,
    });

    return {
      document,
      cookie: this.authDiscordService.connectCookie({ value: browserKey, maxAge: INTENT_TTL_SECONDS }),
    };
  }

  /**
   * Confirms a connect from the signed-in page the callback returned to. The token and its intent are
   * deleted whatever the result. Links only when the token leads to an intent with a Discord account
   * attached and the CLS user created that intent. The checks and the write run under a per-Discord-id
   * lock; a held lock answers `failed`.
   */
  async confirm(params: { confirmToken: string }): Promise<JsonApiSingleDocument> {
    const intent = await this.store.consumeByConfirmToken(params.confirmToken);
    const userId = this.clsService.get("userId");

    let result: DiscordConnectResult = "failed";

    if (intent && userId && intent.userId === userId && intent.discord) {
      const discord = intent.discord;
      const queue = this.config.get<ConfigRedisInterface>("redis").queue;

      const locked = await this.redisLockService.withLock(
        `${queue}:discord-link:${discord.id}`,
        LINK_LOCK_TTL_SECONDS,
        async (): Promise<DiscordConnectResult> => {
          const existing = await this.classify({ userId, discordId: discord.id });
          if (existing) return existing;

          const linked = await this.discordUserService.link({
            userId,
            userDetails: { id: discord.id, username: discord.username, avatar: discord.avatar },
          });
          if (linked === "linked") return "connected";

          // Blocked by a race: the lookups tell what happened.
          return (await this.classify({ userId, discordId: discord.id })) ?? "failed";
        },
      );

      result = locked ?? "failed";
    }

    return this.jsonApiService.buildSingle(DiscordConnectConfirmationDescriptor.model, {
      id: params.confirmToken,
      result,
      discordName: result === "connected" ? intent?.discord?.username : undefined,
    });
  }

  /** connected / taken / already from the current links, or undefined when nothing is linked. */
  private async classify(params: { userId: string; discordId: string }): Promise<DiscordConnectResult | undefined> {
    const byDiscordId = await this.discordUserRepository.findByDiscordId({ discordId: params.discordId });
    if (byDiscordId) return byDiscordId.user?.id === params.userId ? "connected" : "taken";

    if (await this.discordUserRepository.findByUserId({ userId: params.userId })) return "already";

    return undefined;
  }
}
