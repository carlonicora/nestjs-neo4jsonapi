import { InjectQueue } from "@nestjs/bullmq";
import { Injectable } from "@nestjs/common";
import { ModuleRef } from "@nestjs/core";
import { ConfigService } from "@nestjs/config";
import { Queue } from "bullmq";
import { ClsService } from "nestjs-cls";
import { ConfigAuthInterface } from "../../../config/interfaces/config.auth.interface";
import { QueueId } from "../../../config/enums/queue.id";
import { JsonApiService } from "../../../core/jsonapi/services/jsonapi.service";
import { AppLoggingService } from "../../../core/logging/services/logging.service";
import { AbstractService } from "../../../core/neo4j/abstracts/abstract.service";
import { User, UserDescriptor } from "../../user/entities/user";
import { ResponseLanguageService } from "../../user/services/response-language.service";
import {
  ACCOUNT_DELETED_EMAIL_JOB_OPTIONS,
  ACCOUNT_DELETION_JOB_NAMES,
  AccountDeletedEmailJobData,
  accountDeletedEmailJobId,
} from "../account-deletion.constants";
import type { AccountDeletionHandler } from "../interfaces/account-deletion-handler.interface";
import { ACCOUNT_DELETION_HANDLER } from "../interfaces/account-deletion-handler.interface";
import { AccountDeletionRepository } from "../repositories/account-deletion.repository";
import { AccountDeletionWipeRepository } from "../repositories/account-deletion.wipe.repository";
import { hasDeliverableEmail } from "../utils/deliverable-email";
import { FullCompanyDeletionService } from "./full-company-deletion.service";

/**
 * The account wipe run by the worker (`AccountDeletionProcessor`, job
 * `delete-account`). Every step tolerates "already gone", and the User node is
 * deleted last, so a crash leaves a past `deletionScheduledAt` and the next run
 * finishes the job. Logs carry ids only.
 */
@Injectable()
export class AccountWipeService extends AbstractService<User, typeof UserDescriptor.relationships> {
  protected readonly descriptor = UserDescriptor;

  constructor(
    jsonApiService: JsonApiService,
    @InjectQueue(QueueId.ACCOUNT_DELETION) private readonly queue: Queue,
    private readonly accountDeletionRepository: AccountDeletionRepository,
    private readonly wipeRepository: AccountDeletionWipeRepository,
    private readonly fullCompanyDeletionService: FullCompanyDeletionService,
    private readonly responseLanguageService: ResponseLanguageService,
    private readonly configService: ConfigService,
    clsService: ClsService,
    private readonly logger: AppLoggingService,
    private readonly moduleRef: ModuleRef,
  ) {
    super(jsonApiService, accountDeletionRepository, clsService, UserDescriptor.model);
  }

  /**
   * The app handler comes from an app module, looked up at call time like AccountDeletionService
   * does. Injected with @Optional it resolved to undefined here (provider cycle through
   * COMPANY_DELETION_HANDLER), so the app content step was silently skipped.
   */
  private get handler(): AccountDeletionHandler | undefined {
    try {
      return this.moduleRef.get<AccountDeletionHandler>(ACCOUNT_DELETION_HANDLER, { strict: false }) ?? undefined;
    } catch {
      return undefined;
    }
  }

  /** Runs inside the processor's `clsService.run`; sets the CLS user and company itself. */
  async deleteAccount(params: { userId: string }): Promise<void> {
    const { userId } = params;

    // 0. Load and re-check: the request may have been cancelled after the job was queued
    const user = await this.accountDeletionRepository.findTargetUser({ userId });
    if (!user) {
      this.logger.log(`Account ${userId} already deleted`, "AccountWipeService");
      return;
    }

    const scheduledAt = user.deletionScheduledAt ? new Date(user.deletionScheduledAt) : undefined;
    if (!scheduledAt || scheduledAt.getTime() > Date.now()) {
      this.logger.log(`Account ${userId} deletion cancelled or not due, skipping`, "AccountWipeService");
      return;
    }

    const summary = await this.accountDeletionRepository.findMembershipSummary({ userId });
    const deletesCompany = !!summary.companyId && summary.memberCount === 1;
    const wipedCompanyId = deletesCompany ? summary.companyId : undefined;

    const email = user.email ?? "";
    const sendsFinalEmail = hasDeliverableEmail(email);
    const locale = sendsFinalEmail ? await this.resolveLocale(email) : undefined;
    const name = user.name ?? "";

    this.clsService.set("userId", userId);
    if (summary.companyId) this.clsService.set("companyId", summary.companyId);

    this.logger.log(
      `Deleting account ${userId}${wipedCompanyId ? ` with company ${wipedCompanyId}` : ""}`,
      "AccountWipeService",
    );

    // 1. App hook: the user's traces in companies that stay
    const handler = this.handler;
    if (handler) await handler.removeUserTraces({ userId, wipedCompanyId });
    else this.logger.warn(`No ACCOUNT_DELETION_HANDLER: app traces of ${userId} not removed`, "AccountWipeService");

    // 2. The user's own company, when they are its only member
    if (wipedCompanyId) await this.fullCompanyDeletionService.wipeCompany({ companyId: wipedCompanyId });

    // 3. User-linked nodes, email-keyed entries, avatar, cache
    await this.fullCompanyDeletionService.removeUserLinkedData({ user, wipedCompanyId });

    // 4. Final email, deduplicated by job id so a re-run never sends a second one
    if (sendsFinalEmail) {
      const data: AccountDeletedEmailJobData = { to: email, name, locale: locale! };
      await this.queue.add(ACCOUNT_DELETION_JOB_NAMES.accountDeletedEmail, data, {
        ...ACCOUNT_DELETED_EMAIL_JOB_OPTIONS,
        jobId: accountDeletedEmailJobId(userId),
      });
    }

    // 5. The User node, last
    await this.wipeRepository.deleteUserNode({ userId });

    this.logger.log(`Account ${userId} deleted`, "AccountWipeService");
  }

  private async resolveLocale(email: string): Promise<string> {
    const saved = await this.responseLanguageService.resolveForEmail({ email });
    return saved ?? this.configService.get<ConfigAuthInterface>("auth")?.emailLocale ?? "en";
  }
}
