import { BadRequestException, Inject, Injectable, Logger, NotFoundException } from "@nestjs/common";
import { InjectQueue } from "@nestjs/bullmq";
import { createHash, randomUUID } from "crypto";
import { Queue } from "bullmq";
import { ClsService } from "nestjs-cls";

import { baseConfig } from "../../../config/base.config";
import { JsonApiService } from "../../../core/jsonapi/services/jsonapi.service";
import { CacheService } from "../../../core/cache/services/cache.service";
import { ResponseLanguageService } from "../../user/services/response-language.service";
import { QueueId } from "../../../config/enums/queue.id";
import { CompanyRepository } from "../../company/repositories/company.repository";
import { UserRepository } from "../../user/repositories/user.repository";
import { ReferralRepository } from "../repositories/referral.repository";
import { ReferralCodeDescriptor } from "../entities/referral-code";
import { REFERRAL_SOURCE } from "../entities/referral-source";
import { ReferralStatsDescriptor } from "../entities/referral-stats";
import { REFERRAL_CONFIG, ReferralModuleConfig } from "../interfaces/referral.config.interface";
import { ReferralCompletionHandler } from "../../stripe-webhook/interfaces/referral-completion-handler.interface";
import { JsonApiSingleDocument } from "../../../core/jsonapi/interfaces/jsonapi.document.interface";

/**
 * Referral statistics returned by getStats
 */
export interface ReferralStats {
  referralCode: string;
  completedReferrals: number;
  totalTokensEarned: number;
}

@Injectable()
export class ReferralService implements ReferralCompletionHandler {
  private readonly logger = new Logger(ReferralService.name);

  constructor(
    @Inject(REFERRAL_CONFIG) private readonly config: Required<ReferralModuleConfig>,
    private readonly jsonApiService: JsonApiService,
    private readonly referralRepository: ReferralRepository,
    private readonly companyRepository: CompanyRepository,
    private readonly userRepository: UserRepository,
    private readonly clsService: ClsService,
    private readonly cacheService: CacheService,
    @InjectQueue(QueueId.EMAIL) private readonly emailQueue: Queue,
    private readonly responseLanguage: ResponseLanguageService,
  ) {}

  /**
   * Check if the referral feature is enabled.
   */
  get isEnabled(): boolean {
    return this.config.enabled;
  }

  /**
   * Generate a Redis key for tracking referral invites.
   * Uses SHA-256 hash of the email for privacy.
   */
  private getReferralInviteKey(companyId: string, email: string): string {
    const emailHash = createHash("sha256").update(email.toLowerCase().trim()).digest("hex");
    return `referral_invite:${companyId}:${emailHash}`;
  }

  /**
   * Build the referral URL from the configured app URL (APP_URL).
   *
   * `app.url` is normalised with a trailing slash by the config layer, so it is
   * stripped here to avoid a doubled separator before `/register`.
   */
  private buildReferralUrl(referralCode: string): string {
    const base = baseConfig.app.url.replace(/\/$/, "");
    return `${base}/register?ref=${referralCode}`;
  }

  /**
   * Get the current company's referral code, creating one if it doesn't exist.
   * @returns The referral code for the current company
   */
  async getOrCreateReferralCode(): Promise<string> {
    const companyId = this.clsService.get("companyId") as string;
    const company = await this.companyRepository.findByCompanyId({ companyId });

    if (company.referralCode) {
      return company.referralCode;
    }

    // Generate a new UUID-based referral code
    const referralCode = randomUUID();
    await this.companyRepository.setReferralCode({ companyId, referralCode });

    this.logger.log(`Generated new referral code for company ${companyId}`);
    return referralCode;
  }

  /**
   * Track a referral by creating a pending referral between companies.
   * Silently ignores invalid referral codes (no error thrown).
   * Does nothing if referral feature is disabled.
   * @param params.referralCode - The referral code from the referrer company
   */
  async trackReferral(params: { referralCode: string }): Promise<void> {
    if (!this.isEnabled) {
      this.logger.debug("Referral feature is disabled, skipping trackReferral");
      return;
    }

    const referredCompanyId = this.clsService.get("companyId") as string;

    // Find the referrer company by referral code
    const referrerCompany = await this.companyRepository.findByReferralCode({
      referralCode: params.referralCode,
    });

    if (!referrerCompany) {
      // Silently ignore invalid referral codes
      this.logger.debug(`Invalid referral code: ${params.referralCode}`);
      return;
    }

    // Prevent self-referral
    if (referrerCompany.id === referredCompanyId) {
      this.logger.debug(`Self-referral attempted by company ${referredCompanyId}`);
      return;
    }

    // Create the pending referral
    const referralId = randomUUID();
    const created = await this.referralRepository.createReferral({
      id: referralId,
      referrerCompanyId: referrerCompany.id,
      referredCompanyId,
      source: REFERRAL_SOURCE.link,
    });

    if (created) {
      this.logger.log(`Created pending referral ${referralId}: ${referrerCompany.id} referred ${referredCompanyId}`);
    } else {
      this.logger.error(
        `FAILED to create referral ${referralId}: referrer=${referrerCompany.id}, referred=${referredCompanyId} - one or both companies not found in database`,
      );
    }
  }

  /**
   * Records who referred whom without rewarding anyone. Works while the referral
   * feature is disabled. A later payment completes it only if the feature is
   * enabled then. Both ids must be server-derived, never taken from a request.
   *
   * Writes a `pending` Referral once per referred company; an existing one is never
   * changed. A self-referral (equal ids) is ignored.
   * @param params.referrerCompanyId - The company that brought the referred one in
   * @param params.referredCompanyId - The company being referred
   */
  async recordReferral(params: { referrerCompanyId: string; referredCompanyId: string }): Promise<void> {
    if (params.referrerCompanyId === params.referredCompanyId) return;

    await this.referralRepository.createReferralIfAbsent({
      id: randomUUID(),
      referrerCompanyId: params.referrerCompanyId,
      referredCompanyId: params.referredCompanyId,
      source: REFERRAL_SOURCE.direct,
    });
  }

  /**
   * Record one visit to a referral link. Never throws for a bad code: an empty or
   * unknown code, or a disabled feature, writes nothing. Never feeds a reward.
   * @param params.referralCode - The referral code from the visited link
   */
  async recordVisit(params: { referralCode: string }): Promise<void> {
    if (!this.isEnabled) return;
    if (!params.referralCode) return;

    const referrerCompany = await this.companyRepository.findByReferralCode({
      referralCode: params.referralCode,
    });
    if (!referrerCompany) return;

    await this.referralRepository.createVisit({
      id: randomUUID(),
      referrerCompanyId: referrerCompany.id,
    });
  }

  /**
   * Queue a referral invite email to be sent.
   * Enforces a configurable cooldown per company+email to prevent spam.
   * @param params.email - The email address to send the invite to
   * @throws BadRequestException (code REFERRAL_ALREADY_INVITED) if the email was already invited within the cooldown period
   * @throws BadRequestException (code REFERRAL_ALREADY_REGISTERED) if the email is already registered in the system
   */
  async sendReferralInvite(params: { email: string }): Promise<void> {
    const companyId = this.clsService.get("companyId") as string;
    const userId = this.clsService.get("userId") as string;

    // Check if this email was already invited within the cooldown period
    const inviteKey = this.getReferralInviteKey(companyId, params.email);
    const redis = this.cacheService.getRedisClient();
    const existingInvite = await redis.get(inviteKey);

    if (existingInvite) {
      throw new BadRequestException({
        code: "REFERRAL_ALREADY_INVITED",
        message: "You already sent an invitation to this email recently",
      });
    }

    // Check if the email is already registered in the system
    const existingUser = await this.userRepository.findByEmail({ email: params.email });
    if (existingUser) {
      throw new BadRequestException({
        code: "REFERRAL_ALREADY_REGISTERED",
        message: "This email is already registered in the system",
      });
    }

    const company = await this.companyRepository.findByCompanyId({ companyId });
    const user = await this.userRepository.findByUserId({ userId, companyId });

    // Ensure company has a referral code
    const referralCode = company.referralCode || (await this.getOrCreateReferralCode());

    // Mark this email as invited (with configured TTL)
    await redis.setex(inviteKey, this.config.inviteCooldownSeconds, "1");
    await this.referralRepository.createInvite({ id: randomUUID(), companyId, userId });

    await this.emailQueue.add("referral-invite", {
      jobType: "referral-invite",
      payload: {
        to: params.email,
        referralCode,
        companyName: company.name,
        inviterName: user.name,
        inviterEmail: user.email,
        referralUrl: this.buildReferralUrl(referralCode),
        // The invitee is not a user: the invite goes out in the inviter's language.
        // Undefined when i18n is disabled, so the queued payload stays unchanged.
        locale: await this.responseLanguage.resolve(),
      },
    });

    this.logger.log(`Queued referral invite email to ${params.email} from user ${userId}`);
  }

  /**
   * Complete a referral when a payment is made by the referred company.
   * Awards tokens to both the referrer and referred companies.
   * Does nothing if referral feature is disabled.
   * @param params.referredCompanyId - The ID of the company that made the payment
   */
  async completeReferralOnPayment(params: { referredCompanyId: string }): Promise<void> {
    if (!this.isEnabled) {
      this.logger.debug("Referral feature is disabled, skipping completeReferralOnPayment");
      return;
    }

    // Find pending referral for this referred company
    const referral = await this.referralRepository.findPendingByReferredCompanyId({
      referredCompanyId: params.referredCompanyId,
    });

    if (!referral) {
      // No pending referral found - this is normal for non-referred signups
      this.logger.debug(`No pending referral found for company ${params.referredCompanyId}`);
      return;
    }

    const rewardTokens = this.config.rewardTokens;

    // Award tokens to both companies
    const referrerCompanyId = referral.referrer?.id;
    if (referrerCompanyId) {
      await this.companyRepository.addExtraCredits({
        companyId: referrerCompanyId,
        credits: rewardTokens,
      });
      this.logger.log(`Awarded ${rewardTokens} tokens to referrer company ${referrerCompanyId}`);

      // Send reward email to referrer company admins
      try {
        const referrerAdmins = await this.userRepository.findAdminsByCompanyId({
          companyId: referrerCompanyId,
        });

        for (const admin of referrerAdmins) {
          if (admin.email) {
            await this.emailQueue.add("referral-reward", {
              jobType: "referral-reward",
              payload: {
                to: admin.email,
                userName: admin.name,
                tokensAwarded: rewardTokens,
                locale: await this.responseLanguage.resolveForUser({ userId: admin.id }),
              },
            });
          }
        }

        this.logger.log(
          `Queued referral reward email to ${referrerAdmins.length} admin(s) of company ${referrerCompanyId}`,
        );
      } catch (error) {
        // Non-blocking - don't fail the referral completion if email fails
        this.logger.error(`Failed to queue referral reward email: ${error.message}`);
      }
    }

    await this.companyRepository.addExtraCredits({
      companyId: params.referredCompanyId,
      credits: rewardTokens,
    });
    this.logger.log(`Awarded ${rewardTokens} tokens to referred company ${params.referredCompanyId}`);

    // Mark referral as completed
    await this.referralRepository.completeReferral({
      referralId: referral.id,
      tokensAwarded: rewardTokens,
    });

    this.logger.log(`Completed referral ${referral.id}`);
  }

  /**
   * Get referral statistics for the current company.
   * @returns Referral code, completed count, and total tokens earned
   */
  async getStats(): Promise<ReferralStats> {
    const companyId = this.clsService.get("companyId") as string;
    const company = await this.companyRepository.findByCompanyId({ companyId });
    if (!company) {
      throw new NotFoundException("Company not found");
    }

    // Get or create referral code
    const referralCode = company.referralCode || (await this.getOrCreateReferralCode());

    // Count completed referrals where this company was the referrer
    const completedCount = await this.referralRepository.countCompletedByReferrerCompanyId({
      referrerCompanyId: companyId,
    });

    // Calculate total tokens earned from referrals using configured reward amount
    const totalTokensEarned = completedCount * this.config.rewardTokens;

    return {
      referralCode,
      completedReferrals: completedCount,
      totalTokensEarned,
    };
  }

  /**
   * Get the current company's referral code as JSON:API response.
   * Creates a new code if one doesn't exist.
   * @returns JSON:API formatted referral code response
   */
  async getMyCodeJsonApi(): Promise<JsonApiSingleDocument> {
    const companyId = this.clsService.get("companyId") as string;
    const referralCode = await this.getOrCreateReferralCode();

    return this.jsonApiService.buildSingle(ReferralCodeDescriptor.model, {
      id: companyId,
      referralCode,
    });
  }

  /**
   * Get referral statistics as JSON:API response.
   * @returns JSON:API formatted referral stats response
   */
  async getStatsJsonApi(): Promise<JsonApiSingleDocument> {
    const companyId = this.clsService.get("companyId") as string;
    const stats = await this.getStats();

    return this.jsonApiService.buildSingle(ReferralStatsDescriptor.model, {
      id: companyId,
      referralCode: stats.referralCode,
      completedReferrals: stats.completedReferrals,
      totalTokensEarned: stats.totalTokensEarned,
    });
  }
}
