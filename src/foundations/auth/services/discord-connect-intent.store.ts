import { Injectable, OnModuleDestroy } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { Redis } from "ioredis";
import { BaseConfigInterface, ConfigRedisInterface } from "../../../config/interfaces";

/**
 * One Discord connect attempt as kept in Redis.
 */
export interface StoredDiscordConnectIntent {
  userId: string;
  returnPath: string;
  createdAt: string;
  /** SHA-256 (hex) of the `discord_connect` browser key, written by create. */
  browserKeyHash: string;
  /** Set once by the launch route. */
  launched?: boolean;
  /** Written once by the callback. */
  discord?: { id: string; username: string; avatar: string | null };
}

// KEYS[1] intent; ARGV[1] browser key hash. 1 = launched now; 0 = missing, already launched or another browser.
const LAUNCH_SCRIPT = `
local value = redis.call('GET', KEYS[1])
if not value then return 0 end
local intent = cjson.decode(value)
if intent.launched == true or intent.browserKeyHash ~= ARGV[1] then return 0 end
intent.launched = true
redis.call('SET', KEYS[1], cjson.encode(intent), 'KEEPTTL')
return 1
`;

// KEYS[1] intent, KEYS[2] confirmation token; ARGV[1] Discord account JSON, ARGV[2] intent code,
// ARGV[3] confirmation life cap. 1 = attached now; 0 = missing or already attached.
const ATTACH_SCRIPT = `
local value = redis.call('GET', KEYS[1])
if not value then return 0 end
local intent = cjson.decode(value)
if intent.discord ~= nil then return 0 end
local remaining = redis.call('TTL', KEYS[1])
if remaining <= 0 then return 0 end
intent.discord = cjson.decode(ARGV[1])
redis.call('SET', KEYS[1], cjson.encode(intent), 'KEEPTTL')
redis.call('SET', KEYS[2], ARGV[2], 'EX', math.min(tonumber(ARGV[3]), remaining))
return 1
`;

// KEYS[1] confirmation token; ARGV[1] intent key prefix. Deletes the token and the intent, returns the intent.
const CONSUME_BY_CONFIRM_SCRIPT = `
local code = redis.call('GET', KEYS[1])
if not code then return false end
redis.call('DEL', KEYS[1])
local intentKey = ARGV[1] .. code
local value = redis.call('GET', intentKey)
redis.call('DEL', intentKey)
return value
`;

/**
 * The Redis store of Discord connect intents (`${redis.queue}:discord-connect:<code>`, 600 s) and of
 * their confirmation tokens (`${redis.queue}:discord-connect-confirm:<token>`, at most 120 s).
 * Same shape as {@link PendingRegistrationService}.
 */
@Injectable()
export class DiscordConnectIntentStore implements OnModuleDestroy {
  private redis: Redis;
  private readonly INTENT_PREFIX: string;
  private readonly CONFIRM_PREFIX: string;
  private readonly TTL_SECONDS = 600; // 10 minutes
  private readonly CONFIRM_TTL_SECONDS = 120; // 2 minutes, or the intent's remaining life if shorter

  constructor(private readonly configService: ConfigService<BaseConfigInterface>) {
    const redisConfig = this.configService.get<ConfigRedisInterface>("redis");

    this.INTENT_PREFIX = `${redisConfig.queue}:discord-connect:`;
    this.CONFIRM_PREFIX = `${redisConfig.queue}:discord-connect-confirm:`;

    this.redis = new Redis({
      host: redisConfig.host,
      port: redisConfig.port,
      username: redisConfig.username,
      password: redisConfig.password,
    });
  }

  /** Stores a new intent for 600 s. False when the code already exists. */
  async create(params: { code: string; userId: string; returnPath: string; browserKeyHash: string }): Promise<boolean> {
    const intent: StoredDiscordConnectIntent = {
      userId: params.userId,
      returnPath: params.returnPath,
      createdAt: new Date().toISOString(),
      browserKeyHash: params.browserKeyHash,
    };

    const result = await this.redis.set(
      `${this.INTENT_PREFIX}${params.code}`,
      JSON.stringify(intent),
      "EX",
      this.TTL_SECONDS,
      "NX",
    );
    return result === "OK";
  }

  /** Marks the intent launched, once, from the browser that created it. Keeps the expiry. */
  async launch(params: { code: string; browserKeyHash: string }): Promise<boolean> {
    const result = await this.redis.eval(
      LAUNCH_SCRIPT,
      1,
      `${this.INTENT_PREFIX}${params.code}`,
      params.browserKeyHash,
    );
    return Number(result) === 1;
  }

  async get(code: string): Promise<StoredDiscordConnectIntent | null> {
    const data = await this.redis.get(`${this.INTENT_PREFIX}${code}`);
    return data ? (JSON.parse(data) as StoredDiscordConnectIntent) : null;
  }

  /**
   * Attaches the Discord account, once, keeping the intent's expiry, and stores the confirmation
   * token for min(120 s, the intent's remaining life). False when missing or already attached.
   */
  async attachDiscord(params: {
    code: string;
    discord: StoredDiscordConnectIntent["discord"];
    confirmToken: string;
  }): Promise<boolean> {
    const result = await this.redis.eval(
      ATTACH_SCRIPT,
      2,
      `${this.INTENT_PREFIX}${params.code}`,
      `${this.CONFIRM_PREFIX}${params.confirmToken}`,
      JSON.stringify(params.discord),
      params.code,
      this.CONFIRM_TTL_SECONDS,
    );
    return Number(result) === 1;
  }

  /** Reads the intent behind a confirmation token and deletes both. Null for an unknown token. */
  async consumeByConfirmToken(confirmToken: string): Promise<StoredDiscordConnectIntent | null> {
    const data = await this.redis.eval(
      CONSUME_BY_CONFIRM_SCRIPT,
      1,
      `${this.CONFIRM_PREFIX}${confirmToken}`,
      this.INTENT_PREFIX,
    );
    return typeof data === "string" && data ? (JSON.parse(data) as StoredDiscordConnectIntent) : null;
  }

  /** Burns the intent (any callback failure). */
  async consume(code: string): Promise<StoredDiscordConnectIntent | null> {
    const data = await this.redis.getdel(`${this.INTENT_PREFIX}${code}`);
    return data ? (JSON.parse(data) as StoredDiscordConnectIntent) : null;
  }

  async onModuleDestroy() {
    try {
      await this.redis.quit();
    } catch (error) {
      console.error("Error closing Redis connection:", error);
      this.redis.disconnect();
    }
  }
}
