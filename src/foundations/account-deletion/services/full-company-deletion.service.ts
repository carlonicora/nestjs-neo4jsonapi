import { InjectQueue } from "@nestjs/bullmq";
import { Injectable } from "@nestjs/common";
import { ModuleRef } from "@nestjs/core";
import { Queue } from "bullmq";
import { ClsService } from "nestjs-cls";
import { QueueId } from "../../../config/enums/queue.id";
import { CacheService } from "../../../core/cache/services/cache.service";
import { JsonApiService } from "../../../core/jsonapi/services/jsonapi.service";
import { AppLoggingService } from "../../../core/logging/services/logging.service";
import { AbstractService } from "../../../core/neo4j/abstracts/abstract.service";
import type {
  CompanyDeletionHandler,
  DeletionOptions,
} from "../../company/interfaces/company-deletion-handler.interface";
import { S3Service } from "../../s3/services/s3.service";
import { StripeCustomerRepository } from "../../stripe-customer/repositories/stripe-customer.repository";
import { StripeCustomerApiService } from "../../stripe-customer/services/stripe-customer-api.service";
import { User, UserDescriptor } from "../../user/entities/user";
import {
  ACCOUNT_DELETION_JOB_NAMES,
  ACCOUNT_DELETION_JOB_OPTIONS,
  type CompanyWipeJobData,
  WIPE_BATCH_SIZE,
  companyWipeJobId,
} from "../account-deletion.constants";
import type { AccountDeletionHandler } from "../interfaces/account-deletion-handler.interface";
import { ACCOUNT_DELETION_HANDLER } from "../interfaces/account-deletion-handler.interface";
import { AccountDeletionRepository } from "../repositories/account-deletion.repository";
import { AccountDeletionWipeRepository } from "../repositories/account-deletion.wipe.repository";

/**
 * Complete company deletion: app content, Stripe, S3, every company node, the
 * company's placeholder users, then the Company and its Memberships.
 *
 * Mounted only when the app enables `accountDeletion`. An app that wants the
 * admin company delete to be complete provides it as `COMPANY_DELETION_HANDLER`
 * (`{ provide: COMPANY_DELETION_HANDLER, useExisting: FullCompanyDeletionService }`):
 * `deleteCompany` then enqueues the wipe on the worker instead of running it in
 * the HTTP request. Every step is idempotent, so a crashed job re-runs from the top.
 */
@Injectable()
export class FullCompanyDeletionService
  extends AbstractService<User, typeof UserDescriptor.relationships>
  implements CompanyDeletionHandler
{
  protected readonly descriptor = UserDescriptor;

  constructor(
    jsonApiService: JsonApiService,
    @InjectQueue(QueueId.ACCOUNT_DELETION) private readonly queue: Queue,
    private readonly wipeRepository: AccountDeletionWipeRepository,
    private readonly accountDeletionRepository: AccountDeletionRepository,
    private readonly stripeCustomerRepository: StripeCustomerRepository,
    private readonly stripeCustomerApiService: StripeCustomerApiService,
    private readonly s3Service: S3Service,
    private readonly cacheService: CacheService,
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

  /** `CompanyDeletionHandler`: enqueues the wipe; the worker runs it. */
  async deleteCompany(companyId: string, _companyName: string, options?: DeletionOptions): Promise<void> {
    const data: CompanyWipeJobData = { companyId };
    await this.queue.add(ACCOUNT_DELETION_JOB_NAMES.deleteCompany, data, {
      ...ACCOUNT_DELETION_JOB_OPTIONS,
      jobId: companyWipeJobId(companyId),
    });
    this.logger.log(
      `Company ${companyId} queued for full deletion (reason: ${options?.reason ?? "unspecified"})`,
      "FullCompanyDeletionService",
    );
  }

  /**
   * Wipes the company. Runs in the worker, inside a CLS that carries the
   * company id; when the CLS has no user id, the company's first user (members
   * first) is set, because app content deletes need both.
   */
  async wipeCompany(params: { companyId: string }): Promise<void> {
    const { companyId } = params;

    const companyUserIds = await this.wipeRepository.findCompanyUserIds({ companyId });
    // Set when an account wipe calls this: that user is deleted by the account wipe, not here.
    const deletingUserId: string | undefined = this.clsService.get("userId") ?? undefined;
    if (!deletingUserId && companyUserIds.length > 0) {
      this.clsService.set("userId", companyUserIds[0]);
    }
    const actingUserId: string | undefined = this.clsService.get("userId") ?? undefined;

    this.logger.log(`Wiping company ${companyId}`, "FullCompanyDeletionService");

    // 1. App content
    const handler = this.handler;
    if (handler) await handler.deleteCompanyContent({ companyId, actingUserId });
    else
      this.logger.warn(
        `No ACCOUNT_DELETION_HANDLER: app content of ${companyId} left to the generic sweep`,
        "FullCompanyDeletionService",
      );

    // 2. Stripe: the customer in Stripe (cancels anything still active; invoices stay in Stripe), then the local nodes
    const stripeCustomer = await this.stripeCustomerRepository.findByCompanyId({ companyId });
    if (stripeCustomer?.stripeCustomerId) {
      try {
        await this.stripeCustomerApiService.deleteCustomer(stripeCustomer.stripeCustomerId);
      } catch (error) {
        if (!isMissingStripeResource(error)) throw error;
      }
    }
    await this.wipeRepository.deleteStripeNodes({ companyId, batchSize: WIPE_BATCH_SIZE });

    // 3. S3
    await this.s3Service.deleteFolderFromS3({ key: companyFolder(companyId) });

    // 4. Placeholder users (BELONGS_TO the company, no Membership anywhere), found before
    //    the sweep, then every company node, then the shared knowledge left disconnected
    for (const userId of companyUserIds) {
      if (userId === deletingUserId) continue;
      const summary = await this.accountDeletionRepository.findMembershipSummary({ userId });
      if (summary.companyId) continue;

      const user = await this.accountDeletionRepository.findTargetUser({ userId });
      if (!user) continue;

      await this.removeUserLinkedData({ user, wipedCompanyId: companyId });
      await this.wipeRepository.deleteUserNode({ userId });
    }

    await this.wipeRepository.deleteCompanyNodes({ companyId, batchSize: WIPE_BATCH_SIZE });
    await this.wipeRepository.deleteDisconnectedKnowledge({ batchSize: WIPE_BATCH_SIZE });

    // 5. Memberships and the Company
    await this.wipeRepository.deleteCompanyShell({ companyId });

    this.logger.log(`Company ${companyId} wiped`, "FullCompanyDeletionService");
  }

  /**
   * The user's own library nodes, the edges to other people's nodes, the
   * email-keyed entries, the avatar file (when outside the wiped company's
   * folder) and the user's cache. The User node itself stays: the caller
   * deletes it last.
   */
  async removeUserLinkedData(params: { user: User; wipedCompanyId?: string }): Promise<void> {
    const { user, wipedCompanyId } = params;
    const userId = user.id;

    await this.wipeRepository.deleteUserLinkedNodes({ userId, batchSize: WIPE_BATCH_SIZE });
    await this.wipeRepository.detachUserFromForeignNodes({ userId, batchSize: WIPE_BATCH_SIZE });
    await this.wipeRepository.deleteEmailKeyed({ email: user.email ?? "", userId, batchSize: WIPE_BATCH_SIZE });

    const avatar = user.avatar;
    const insideWipedFolder = wipedCompanyId ? avatar?.startsWith(companyFolder(wipedCompanyId)) : false;
    if (avatar && !avatar.startsWith("~") && !insideWipedFolder) {
      await this.s3Service.deleteFileFromS3({ key: avatar });
    }

    await this.cacheService.deleteUserCache(userId);
  }
}

function companyFolder(companyId: string): string {
  return `companies/${companyId}/`;
}

/** Stripe "No such customer / subscription" (`resource_missing`): the resource is already gone. */
export function isMissingStripeResource(error: unknown): boolean {
  const e = error as { stripeCode?: string; code?: string; message?: string } | undefined;
  if (!e) return false;
  if (e.stripeCode === "resource_missing" || e.code === "resource_missing") return true;
  return typeof e.message === "string" && /no such (customer|subscription)/i.test(e.message);
}
