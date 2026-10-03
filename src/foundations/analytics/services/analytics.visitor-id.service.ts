import { Injectable } from "@nestjs/common";
import { createHash, randomBytes } from "crypto";
import { AppLoggingService } from "../../../core/logging/services/logging.service";
import { RedisClientStorageService } from "../../../core/redis/services/redis.client.storage.service";

export const DAILY_HASH_PREFIX = "d:";
export const COOKIE_ID_PREFIX = "c:";

/** 48 hours: long enough to cover a day in any worker, too short to re-derive yesterday's ids later. */
const SALT_TTL_SECONDS = 172800;
const SALT_KEY_PREFIX = "analytics:salt:";

const BOT_PATTERN =
  /bot|crawler|spider|curl|wget|python-requests|headlesschrome|facebookexternalhit|slackbot|twitterbot|linkedinbot|ahrefs|semrush|bingpreview/i;
const TABLET_PATTERN = /ipad|tablet|kindle|silk/i;
const MOBILE_PATTERN = /mobi|iphone|android.*mobile|windows phone/i;

/**
 * Resolves the visitor id an analytics event is attributed to.
 *
 * With consent the browser sends the `analytics_visitor` cookie id, used as
 * `c:<uuid>`. Without consent the id is `d:` + sha256(daily salt + IP + user
 * agent). The salt lives in Redis for 48 hours with set-if-absent semantics, so
 * every worker shares one salt per day and no salt outlives its usefulness.
 * IP and user agent are only hashed or classified here; they are never returned
 * and never stored.
 */
@Injectable()
export class AnalyticsVisitorIdService {
  private readonly localSalts = new Map<string, string>();
  private readonly warnedDays = new Set<string>();

  constructor(
    private readonly redis: RedisClientStorageService,
    private readonly logger: AppLoggingService,
  ) {}

  isBot(userAgent: string): boolean {
    return BOT_PATTERN.test(userAgent ?? "");
  }

  deviceType(userAgent: string): "desktop" | "mobile" | "tablet" {
    const ua = userAgent ?? "";
    if (TABLET_PATTERN.test(ua)) return "tablet";
    if (MOBILE_PATTERN.test(ua)) return "mobile";
    return "desktop";
  }

  async resolve(input: {
    visitorId?: string;
    clientIp: string;
    userAgent: string;
    receivedAt: string;
  }): Promise<{ visitorId: string; consented: boolean }> {
    if (input.visitorId) return { visitorId: `${COOKIE_ID_PREFIX}${input.visitorId}`, consented: true };

    const salt = await this.dailySalt(input.receivedAt.slice(0, 10));
    const hash = createHash("sha256")
      .update(salt + input.clientIp + input.userAgent)
      .digest("hex");

    return { visitorId: `${DAILY_HASH_PREFIX}${hash}`, consented: false };
  }

  async dailySalt(day: string): Promise<string> {
    const key = `${SALT_KEY_PREFIX}${day}`;

    try {
      const client = this.redis.getRedisClient();
      await client.set(key, randomBytes(32).toString("hex"), "EX", SALT_TTL_SECONDS, "NX");
      const salt = await client.get(key);
      if (!salt) throw new Error(`salt ${key} missing after SET NX`);
      return salt;
    } catch (error) {
      if (!this.warnedDays.has(day)) {
        this.warnedDays.add(day);
        this.logger.warn(
          `Redis unavailable for ${key}, using a process-local salt: ${(error as Error)?.message ?? error}`,
          AnalyticsVisitorIdService.name,
        );
      }

      let salt = this.localSalts.get(day);
      if (!salt) {
        salt = randomBytes(32).toString("hex");
        this.localSalts.set(day, salt);
      }
      return salt;
    }
  }
}
