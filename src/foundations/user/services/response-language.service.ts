import { Injectable } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { ClsService } from "nestjs-cls";
import { BaseConfigInterface, ConfigI18nInterface } from "../../../config/interfaces";
import { UserRepository } from "../repositories/user.repository";

/**
 * Resolves the language a response (AI text, email, bot reply) is written in.
 *
 * Opt-in per app through `config.i18n`. While it is disabled every method
 * returns `undefined`, so callers keep their existing English behaviour.
 *
 * The saved language is read through UserRepository.findForLanguage. The
 * service lives in the user feature because it owns that data; its module is
 * global so LLM, email and feature services can inject it without importing it.
 */
@Injectable()
export class ResponseLanguageService {
  constructor(
    private readonly configService: ConfigService<BaseConfigInterface>,
    private readonly cls: ClsService,
    private readonly users: UserRepository,
  ) {}

  private get i18n(): ConfigI18nInterface | undefined {
    return this.configService.get<ConfigI18nInterface>("i18n");
  }

  private get enabled(): boolean {
    return this.i18n?.enabled === true;
  }

  private get fallback(): string {
    return this.i18n?.supportedLanguages?.[0] ?? "en";
  }

  /**
   * Language for the current context: cached cls "responseLanguage", then the
   * saved language of cls "userId", then cls "language" (x-language header or
   * Discord locale), then the first supported language.
   */
  async resolve(): Promise<string | undefined> {
    if (!this.enabled) return undefined;

    const active = this.cls.isActive();

    const cached = this.normalise(active ? this.cls.get<string>("responseLanguage") : undefined);
    if (cached) return cached;

    const userId = active ? this.cls.get<string>("userId") : undefined;
    const language =
      (userId ? await this.readSavedLanguage({ userId }) : undefined) ??
      this.normalise(active ? this.cls.get<string>("language") : undefined) ??
      this.fallback;

    if (active) this.cls.set("responseLanguage", language);

    return language;
  }

  /** Saved language of that user, else the first supported language. */
  async resolveForUser(params: { userId: string }): Promise<string | undefined> {
    if (!this.enabled) return undefined;

    return (await this.readSavedLanguage({ userId: params.userId })) ?? this.fallback;
  }

  /** Saved language of the user with that email, else the current context's language. */
  async resolveForEmail(params: { email: string }): Promise<string | undefined> {
    if (!this.enabled) return undefined;

    return (await this.readSavedLanguage({ email: params.email })) ?? (await this.resolve());
  }

  /** "it-IT" becomes "it"; an unsupported or empty value becomes undefined. */
  normalise(raw?: string | null): string | undefined {
    if (!raw || typeof raw !== "string") return undefined;

    const code = raw.trim().toLowerCase().split(/[-_]/)[0];
    if (!code) return undefined;

    const supported = this.i18n?.supportedLanguages ?? ["en"];
    return supported.includes(code) ? code : undefined;
  }

  private async readSavedLanguage(params: { userId?: string; email?: string }): Promise<string | undefined> {
    const user = await this.users.findForLanguage(params);

    return this.normalise(user?.language);
  }
}
