import { Injectable, Logger } from "@nestjs/common";
import { REGISTRATION_HOOK, RegistrationHookInterface } from "../../auth/interfaces/registration-hook.interface";
import { ReferralService } from "./referral.service";

/**
 * Registration hook that tracks referrals when new users register.
 * This hook is called by AuthService after a new company is created.
 */
@Injectable()
export class RegistrationReferralHook implements RegistrationHookInterface {
  private readonly logger = new Logger(RegistrationReferralHook.name);

  constructor(private readonly referralService: ReferralService) {}

  /**
   * Called after a new company and user have been created during registration.
   * Tracks the referral if a referral code was provided.
   *
   * @param params.companyId - The newly created company's ID
   * @param params.userId - The newly created user's ID
   * @param params.referralCode - Optional referral code from the registration
   */
  async onRegistrationComplete(params: { companyId: string; userId: string; referralCode?: string }): Promise<void> {
    if (!params.referralCode) {
      return;
    }

    this.logger.log(`Tracking referral for new company ${params.companyId} with code ${params.referralCode}`);

    try {
      // trackReferral uses ClsService to get the companyId, which is already set by AuthService
      await this.referralService.trackReferral({
        referralCode: params.referralCode,
      });
      this.logger.log(`Successfully tracked referral for company ${params.companyId}`);
    } catch (error) {
      // Log the error but don't throw - invalid referral codes should be silently ignored
      this.logger.error(`Failed to track referral for company ${params.companyId}:`, error);
    }
  }
}

/**
 * Provider configuration for the registration hook
 */
export const RegistrationReferralHookProvider = {
  provide: REGISTRATION_HOOK,
  useClass: RegistrationReferralHook,
};
