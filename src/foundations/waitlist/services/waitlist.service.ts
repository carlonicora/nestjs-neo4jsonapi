import { HttpException, HttpStatus, Injectable, Logger } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { randomUUID } from "crypto";
import { ClsService } from "nestjs-cls";
import { BaseConfigInterface, ConfigAppInterface } from "../../../config/interfaces";
import { EmailService } from "../../../core/email/services/email.service";
import { JsonApiDataInterface } from "../../../core/jsonapi/interfaces/jsonapi.data.interface";
import { JsonApiPaginator } from "../../../core/jsonapi/serialisers/jsonapi.paginator";
import { JsonApiService } from "../../../core/jsonapi/services/jsonapi.service";
import { AbstractService } from "../../../core/neo4j/abstracts/abstract.service";
import { UserRepository } from "../../user/repositories/user.repository";
import { WaitlistPostDataDTO } from "../dtos/waitlist.post.dto";
import { Waitlist, WaitlistDescriptor, WaitlistStatus } from "../entities/waitlist";
import { WaitlistRepository } from "../repositories/waitlist.repository";

@Injectable()
export class WaitlistService extends AbstractService<Waitlist, typeof WaitlistDescriptor.relationships> {
  protected readonly descriptor = WaitlistDescriptor;
  private readonly logger: Logger = new Logger(WaitlistService.name);

  constructor(
    jsonApiService: JsonApiService,
    private readonly waitlistRepository: WaitlistRepository,
    clsService: ClsService,
    private readonly emailService: EmailService,
    private readonly configService: ConfigService<BaseConfigInterface>,
    private readonly userRepository: UserRepository,
  ) {
    super(jsonApiService, waitlistRepository, clsService, WaitlistDescriptor.model);
  }

  private get appConfig(): ConfigAppInterface {
    return this.configService.get<ConfigAppInterface>("app");
  }

  /**
   * Create a new waitlist entry with typed DTO.
   * Handles: duplicate check, confirmation code generation, email sending.
   */
  async createEntry(params: { data: WaitlistPostDataDTO }): Promise<JsonApiDataInterface> {
    const { id, attributes } = params.data;
    const email = attributes.email.toLowerCase();

    // Check duplicate
    const existing = await this.waitlistRepository.findByEmail({ email });
    if (existing) {
      throw new HttpException("Email already registered for waitlist", HttpStatus.CONFLICT);
    }

    // Generate confirmation code with 24-hour expiration
    const confirmationCode = randomUUID();
    const confirmationCodeExpiration = new Date();
    confirmationCodeExpiration.setHours(confirmationCodeExpiration.getHours() + 24);
    const now = new Date();

    // Create entry
    await this.repository.create({
      id,
      email,
      gdprConsent: attributes.gdprConsent,
      gdprConsentAt: now.toISOString(),
      marketingConsent: attributes.marketingConsent,
      marketingConsentAt: attributes.marketingConsent ? now.toISOString() : undefined,
      questionnaire: attributes.questionnaire,
      confirmationCode,
      confirmationCodeExpiration: confirmationCodeExpiration.toISOString(),
      status: WaitlistStatus.Pending,
    });

    // Send confirmation email
    const confirmationLink = `${this.appConfig.url}en/waitlist/confirm/${confirmationCode}`;
    await this.emailService.sendEmail(
      "waitlistConfirmation",
      {
        to: email,
        confirmationLink,
        expirationDate: confirmationCodeExpiration.toDateString(),
        expirationTime: confirmationCodeExpiration.toTimeString(),
      },
      "en",
    );

    return this.findById({ id });
  }

  /**
   * Find entries with optional status filter.
   */
  async findAllByStatus(params: { query: any; status?: WaitlistStatus }): Promise<JsonApiDataInterface> {
    const paginator = new JsonApiPaginator(params.query);
    return this.jsonApiService.buildList(
      WaitlistDescriptor.model,
      await this.waitlistRepository.findAllByStatus({
        status: params.status,
        cursor: paginator.generateCursor(),
      }),
      paginator,
    );
  }

  /**
   * Confirm a waitlist entry via confirmation code.
   */
  async confirm(params: { code: string }): Promise<JsonApiDataInterface> {
    const entry = await this.waitlistRepository.findByConfirmationCode({ code: params.code });

    if (!entry) {
      throw new HttpException("Invalid confirmation code", HttpStatus.NOT_FOUND);
    }
    if (entry.confirmationCodeExpiration && entry.confirmationCodeExpiration < new Date()) {
      throw new HttpException("Confirmation code has expired", HttpStatus.BAD_REQUEST);
    }
    if (entry.status !== WaitlistStatus.Pending) {
      throw new HttpException("Entry has already been confirmed", HttpStatus.BAD_REQUEST);
    }

    const confirmedAt = new Date();
    await this.waitlistRepository.updateStatus({
      id: entry.id,
      status: WaitlistStatus.Confirmed,
      confirmedAt,
    });

    // Notify platform administrators (non-blocking)
    await this.notifyAdminsOfConfirmation({
      ...entry,
      confirmedAt,
      status: WaitlistStatus.Confirmed,
    });

    return this.findById({ id: entry.id });
  }

  /**
   * Invite a confirmed waitlist entry.
   */
  async invite(params: { id: string }): Promise<JsonApiDataInterface> {
    const entry = await this.repository.findById({ id: params.id });

    if (!entry) {
      throw new HttpException("Waitlist entry not found", HttpStatus.NOT_FOUND);
    }
    if (entry.status !== WaitlistStatus.Confirmed) {
      throw new HttpException("Can only invite confirmed waitlist entries", HttpStatus.BAD_REQUEST);
    }

    // Generate invite code with 7-day expiration
    const inviteCode = randomUUID();
    const inviteCodeExpiration = new Date();
    inviteCodeExpiration.setDate(inviteCodeExpiration.getDate() + 7);

    await this.waitlistRepository.setInviteCode({
      id: entry.id,
      inviteCode,
      inviteCodeExpiration,
      invitedAt: new Date(),
    });

    // Send invitation email
    const registrationLink = `${this.appConfig.url}en/register?invite=${inviteCode}`;
    await this.emailService.sendEmail(
      "waitlistInvitation",
      {
        to: entry.email,
        registrationLink,
        expirationDate: inviteCodeExpiration.toDateString(),
        expirationTime: inviteCodeExpiration.toTimeString(),
      },
      "en",
    );

    return this.findById({ id: entry.id });
  }

  /**
   * Batch invite multiple entries.
   */
  async inviteBatch(params: { ids: string[] }): Promise<{ invited: number; failed: number }> {
    let invited = 0;
    let failed = 0;

    for (const id of params.ids) {
      try {
        await this.invite({ id });
        invited++;
      } catch {
        failed++;
      }
    }

    return { invited, failed };
  }

  /**
   * Validate an invite code (public endpoint).
   */
  async validateInviteCode(code: string): Promise<{ email: string; valid: boolean } | null> {
    const entry = await this.waitlistRepository.findByInviteCode({ code });

    if (!entry) return null;

    const expired = entry.inviteCodeExpiration && entry.inviteCodeExpiration < new Date();
    const used = entry.status === WaitlistStatus.Registered;

    return { email: entry.email, valid: !expired && !used };
  }

  /**
   * Mark entry as registered after user creates account.
   */
  async markAsRegistered(params: { inviteCode: string; userId: string }): Promise<JsonApiDataInterface> {
    const entry = await this.waitlistRepository.findByInviteCode({ code: params.inviteCode });
    if (!entry) {
      throw new HttpException("Invalid invite code", HttpStatus.NOT_FOUND);
    }

    await this.waitlistRepository.markAsRegistered({
      id: entry.id,
      userId: params.userId,
      registeredAt: new Date(),
    });

    return this.findById({ id: entry.id });
  }

  /**
   * Get waitlist statistics.
   */
  async getStats(): Promise<{
    pending: number;
    confirmed: number;
    invited: number;
    registered: number;
    total: number;
  }> {
    return await this.waitlistRepository.getStats();
  }

  /**
   * Send notification to all platform administrators about a new waitlist confirmation.
   * Errors are logged but not thrown to avoid blocking the confirmation flow.
   */
  private async notifyAdminsOfConfirmation(entry: Waitlist): Promise<void> {
    try {
      const platformAdmins = await this.userRepository.findPlatformAdministrators();

      if (platformAdmins.length === 0) {
        return;
      }

      const dashboardLink = `${this.appConfig.url}en/administration/waitlist`;

      for (const admin of platformAdmins) {
        try {
          await this.emailService.sendEmail(
            "waitlistAdminNotification",
            {
              to: admin.email,
              adminName: admin.name || "Administrator",
              userEmail: entry.email,
              confirmedAt: entry.confirmedAt?.toISOString(),
              questionnaire: entry.questionnaire || null,
              dashboardLink,
            },
            "en",
          );
        } catch (emailError) {
          this.logger.error(`Failed to send waitlist notification to admin ${admin.email}:`, emailError);
        }
      }
    } catch (error) {
      this.logger.error("Failed to send waitlist admin notifications:", error);
    }
  }
}
