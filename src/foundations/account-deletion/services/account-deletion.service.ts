import { BadRequestException, ForbiddenException, Inject, Injectable, Logger, NotFoundException } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { ModuleRef } from "@nestjs/core";
import { createHash, randomBytes } from "crypto";
import { ClsService } from "nestjs-cls";
import { SystemRoles } from "../../../common/constants/system.roles";
import { BaseConfigInterface, ConfigAppInterface, ConfigAuthInterface } from "../../../config/interfaces";
import { EmailService } from "../../../core/email/services/email.service";
import { JsonApiSingleDocument } from "../../../core/jsonapi/interfaces/jsonapi.document.interface";
import { JsonApiService } from "../../../core/jsonapi/services/jsonapi.service";
import { AbstractService } from "../../../core/neo4j/abstracts/abstract.service";
import { StripeCustomerRepository } from "../../stripe-customer/repositories/stripe-customer.repository";
import { StripeSubscriptionRepository } from "../../stripe-subscription/repositories/stripe-subscription.repository";
import { StripeSubscriptionApiService } from "../../stripe-subscription/services/stripe-subscription-api.service";
import { StripeSubscription, StripeSubscriptionStatus } from "../../stripe-subscription/entities/stripe-subscription";
import { User, UserDescriptor } from "../../user/entities/user";
import { ResponseLanguageService } from "../../user/services/response-language.service";
import {
  ACCOUNT_DELETION_CONFIG,
  AccountDeletionModuleConfig,
  DEFAULT_ACCOUNT_DELETION_CONFIG,
} from "../account-deletion.config";
import { AccountDeletion, AccountDeletionDescriptor } from "../entities/account-deletion";
import {
  ACCOUNT_DELETION_HANDLER,
  AccountDeletionHandler,
  AccountDeletionImpact,
} from "../interfaces/account-deletion-handler.interface";
import { AccountDeletionLoginHook } from "../interfaces/account-deletion-login-hook.interface";
import { AccountDeletionRepository } from "../repositories/account-deletion.repository";
import { hasDeliverableEmail } from "../utils/deliverable-email";
import { isMissingStripeResource } from "./full-company-deletion.service";

const ONE_DAY_MS = 24 * 60 * 60 * 1000;
const KEEP_LINK_FAILURE = "This link no longer works";
const UNDELIVERABLE_CONFIRMATIONS = ["DELETE", "ELIMINA"];
const CANCELLABLE_STATUSES: StripeSubscriptionStatus[] = ["active", "trialing", "past_due"];

type TargetContext = {
  user: User;
  /** Company of the user's Membership; null for a placeholder (no Membership). */
  membershipCompanyId: string | null;
  /** The company goes with the user only when the user is its only member. */
  deletesCompany: boolean;
  /** Company bound in the target CLS: the membership company, else the BELONGS_TO one. */
  clsCompanyId: string | undefined;
};

/**
 * The request side of account deletion: preview, request (self and admin), the
 * public keep link and cancel-on-login. The wipe itself runs in the worker
 * (AccountWipeService).
 *
 * Every response is the synthetic `account-deletions` resource built with
 * `buildSingle(AccountDeletionDescriptor.model, ...)`; `id` is the user id.
 */
@Injectable()
export class AccountDeletionService
  extends AbstractService<User, typeof UserDescriptor.relationships>
  implements AccountDeletionLoginHook
{
  protected readonly descriptor = UserDescriptor;

  private readonly logger = new Logger(AccountDeletionService.name);

  constructor(
    jsonApiService: JsonApiService,
    private readonly accountDeletionRepository: AccountDeletionRepository,
    clsService: ClsService,
    private readonly stripeCustomerRepository: StripeCustomerRepository,
    private readonly stripeSubscriptionRepository: StripeSubscriptionRepository,
    private readonly stripeSubscriptionApiService: StripeSubscriptionApiService,
    private readonly emailService: EmailService,
    private readonly responseLanguage: ResponseLanguageService,
    private readonly configService: ConfigService<BaseConfigInterface>,
    private readonly moduleRef: ModuleRef,
    @Inject(ACCOUNT_DELETION_CONFIG)
    private readonly config: AccountDeletionModuleConfig,
  ) {
    super(jsonApiService, accountDeletionRepository, clsService, UserDescriptor.model);
  }

  private get graceDays(): number {
    return this.config?.graceDays ?? DEFAULT_ACCOUNT_DELETION_CONFIG.graceDays;
  }

  /**
   * The app handler is provided by an app module (not global), so it is looked
   * up lazily at call time, like AuthService's registration hook. Resolving it
   * in the constructor would capture Nest's placeholder.
   */
  private get handler(): AccountDeletionHandler | undefined {
    try {
      return this.moduleRef.get<AccountDeletionHandler>(ACCOUNT_DELETION_HANDLER, { strict: false }) ?? undefined;
    } catch {
      return undefined;
    }
  }

  async findPreview(params: { userId: string }): Promise<JsonApiSingleDocument> {
    const target = await this._loadTarget({ userId: params.userId });
    const subscriptions = await this._activeSubscriptions(target);
    const impact = await this._describeImpact(target);

    return this._build({
      target,
      requestedAt: target.user.deletionRequestedAt,
      scheduledAt: target.user.deletionScheduledAt,
      hasActiveSubscription: subscriptions.length > 0,
      impact,
    });
  }

  async request(params: {
    targetUserId: string;
    actingUserId: string;
    confirmation: string;
  }): Promise<JsonApiSingleDocument> {
    // Second line of defence behind the controller's @Roles(Administrator).
    if (params.targetUserId !== params.actingUserId && !this._isAdministrator())
      throw new ForbiddenException("You can only delete your own account");

    const target = await this._loadTarget({ userId: params.targetUserId });

    // A request is already pending: keep its date and token, send nothing, touch no subscription.
    if (target.user.deletionScheduledAt) {
      const subscriptions = await this._activeSubscriptions(target);
      return this._build({
        target,
        requestedAt: target.user.deletionRequestedAt,
        scheduledAt: target.user.deletionScheduledAt,
        hasActiveSubscription: subscriptions.length > 0,
        impact: await this._describeImpact(target),
      });
    }

    this._assertConfirmation({ user: target.user, confirmation: params.confirmation });

    const requestedAt = new Date();
    const scheduledAt = new Date(requestedAt.getTime() + this.graceDays * ONE_DAY_MS);
    const deliverable = hasDeliverableEmail(target.user.email);

    // Undeliverable users get no email, so no undo token is stored: only logging in cancels.
    const undoToken = deliverable ? randomBytes(32).toString("base64url") : null;

    // Cancelled now, not at the wipe, so no renewal is charged during the grace period. Before
    // setRequest: if Stripe fails nothing is stored, and a retry cancels again instead of taking
    // the "already pending" path above, which never cancels.
    const subscriptions = await this._activeSubscriptions(target);
    for (const subscription of subscriptions) await this._cancelNow(target, subscription);

    await this.accountDeletionRepository.setRequest({
      userId: target.user.id,
      requestedAt: requestedAt.toISOString(),
      scheduledAt: scheduledAt.toISOString(),
      undoTokenHash: undoToken ? this._hash(undoToken) : null,
    });

    await this.accountDeletionRepository.deleteSessions({ userId: target.user.id });

    if (undoToken) {
      await this._sendRequestEmail({
        user: target.user,
        scheduledAt,
        undoToken,
        subscriptionCancelled: subscriptions.length > 0,
      });
    }

    this.logger.log(`Account deletion requested for user ${target.user.id} by ${params.actingUserId}`);

    return this._build({
      target,
      requestedAt,
      scheduledAt,
      hasActiveSubscription: false,
      impact: await this._describeImpact(target),
    });
  }

  /** Public undo link. Any failure gives the same answer, so no account can be probed. */
  async keep(params: { token: string }): Promise<void> {
    try {
      const user = await this.accountDeletionRepository.findByUndoTokenHash({
        undoTokenHash: this._hash(params.token),
      });

      if (!user?.deletionScheduledAt || new Date(user.deletionScheduledAt).getTime() <= Date.now())
        throw new NotFoundException(KEEP_LINK_FAILURE);

      await this.accountDeletionRepository.clearRequest({ userId: user.id });
      this.logger.log(`Account deletion cancelled by link for user ${user.id}`);
    } catch {
      throw new NotFoundException(KEEP_LINK_FAILURE);
    }
  }

  /** Login hook (ACCOUNT_DELETION_LOGIN_HOOK): a fresh login cancels a pending request. */
  async cancelOnLogin(params: { userId: string }): Promise<boolean> {
    const user = await this.accountDeletionRepository.findTargetUser({ userId: params.userId });
    if (!user?.deletionScheduledAt) return false;

    await this.accountDeletionRepository.clearRequest({ userId: params.userId });
    this.logger.log(`Account deletion cancelled by login for user ${params.userId}`);
    return true;
  }

  private async _loadTarget(params: { userId: string }): Promise<TargetContext> {
    const user = await this.accountDeletionRepository.findTargetUser({ userId: params.userId });
    if (!user) throw new NotFoundException("User not found");

    const summary = await this.accountDeletionRepository.findMembershipSummary({ userId: params.userId });
    const deletesCompany = summary.companyId !== null && summary.memberCount === 1;

    return {
      user,
      membershipCompanyId: summary.companyId,
      deletesCompany,
      clsCompanyId: summary.companyId ?? user.company?.id ?? undefined,
    };
  }

  /**
   * Runs the callback as the TARGET user (OD-4): a fresh CLS context with the
   * target's userId and companyId, so an admin acting on another user reads the
   * target's company, never the admin's.
   */
  private _asTarget<T>(target: TargetContext, callback: () => Promise<T>): Promise<T> {
    return this.clsService.run({ ifNested: "override" }, async () => {
      this.clsService.set("userId", target.user.id);
      if (target.clsCompanyId) this.clsService.set("companyId", target.clsCompanyId);
      return callback();
    });
  }

  /** Active, trialing and past-due subscriptions of the company that goes with the user; none when the company stays. */
  private async _activeSubscriptions(target: TargetContext): Promise<StripeSubscription[]> {
    if (!target.deletesCompany || !target.membershipCompanyId) return [];
    const companyId = target.membershipCompanyId;

    return this._asTarget(target, async () => {
      const customer = await this.stripeCustomerRepository.findByCompanyId({ companyId });
      if (!customer?.id) return [];
      // findByStripeCustomerId matches the local StripeCustomer node id, not the cus_ id
      const subscriptions =
        (await this.stripeSubscriptionRepository.findByStripeCustomerId({
          stripeCustomerId: customer.id,
        })) ?? [];
      return subscriptions.filter((subscription) => CANCELLABLE_STATUSES.includes(subscription.status));
    });
  }

  /**
   * Cancels one subscription at once and records it locally, so a second request does not
   * cancel it again before Stripe's webhook arrives. A subscription Stripe no longer knows
   * (already cancelled) counts as cancelled.
   */
  private async _cancelNow(target: TargetContext, subscription: StripeSubscription): Promise<void> {
    try {
      await this.stripeSubscriptionApiService.cancelSubscription(subscription.stripeSubscriptionId, false);
    } catch (error) {
      if (!isMissingStripeResource(error)) throw error;
      this.logger.log(`Subscription ${subscription.id} already gone in Stripe, marking it cancelled`);
    }
    await this._asTarget(target, () =>
      this.stripeSubscriptionRepository.update({ id: subscription.id, status: "canceled", canceledAt: new Date() }),
    );
  }

  private async _describeImpact(target: TargetContext): Promise<AccountDeletionImpact> {
    const handler = this.handler;
    if (!handler) return { ownedCount: 0, otherTables: [] };

    return this._asTarget(target, () =>
      handler.describeImpact({
        userId: target.user.id,
        companyId: target.membershipCompanyId ?? undefined,
        deletesCompany: target.deletesCompany,
      }),
    );
  }

  private _assertConfirmation(params: { user: User; confirmation: string }): void {
    const confirmation = (params.confirmation ?? "").trim();

    const matches = hasDeliverableEmail(params.user.email)
      ? confirmation.toLowerCase() === params.user.email.trim().toLowerCase()
      : UNDELIVERABLE_CONFIRMATIONS.includes(confirmation.toUpperCase());

    if (!matches) throw new BadRequestException("The confirmation does not match");
  }

  private _isAdministrator(): boolean {
    const roles = this.clsService.get("roles");
    return Array.isArray(roles) && roles.includes(SystemRoles.Administrator);
  }

  private _hash(token: string): string {
    return createHash("sha256").update(token).digest("hex");
  }

  private async _sendRequestEmail(params: {
    user: User;
    scheduledAt: Date;
    undoToken: string;
    subscriptionCancelled: boolean;
  }): Promise<void> {
    const appConfig = this.configService.get<ConfigAppInterface>("app");
    const authConfig = this.configService.get<ConfigAuthInterface>("auth");

    const locale =
      (await this.responseLanguage.resolveForEmail({ email: params.user.email })) ?? authConfig?.emailLocale ?? "en";

    await this.emailService.sendEmail(
      "accountDeletionRequested",
      {
        to: params.user.email,
        name: params.user.name ?? "",
        deletionDate: params.scheduledAt.toLocaleDateString(locale, {
          day: "numeric",
          month: "long",
          year: "numeric",
        }),
        keepUrl: `${appConfig?.url ?? ""}account/keep?token=${encodeURIComponent(params.undoToken)}`,
        subscriptionCancelled: params.subscriptionCancelled,
      },
      locale,
    );
  }

  private async _build(params: {
    target: TargetContext;
    requestedAt?: Date;
    scheduledAt?: Date;
    hasActiveSubscription: boolean;
    impact: AccountDeletionImpact;
  }): Promise<JsonApiSingleDocument> {
    const now = new Date();
    const preview: AccountDeletion = {
      id: params.target.user.id,
      type: AccountDeletionDescriptor.model.type,
      createdAt: now,
      updatedAt: now,
      requestedAt: params.requestedAt ? new Date(params.requestedAt) : undefined,
      scheduledAt: params.scheduledAt ? new Date(params.scheduledAt) : undefined,
      hasDeliverableEmail: hasDeliverableEmail(params.target.user.email),
      hasActiveSubscription: params.hasActiveSubscription,
      deletesCompany: params.target.deletesCompany,
      ownedCount: params.target.deletesCompany ? params.impact.ownedCount : 0,
      otherTables: params.impact.otherTables ?? [],
    };

    return this.jsonApiService.buildSingle(AccountDeletionDescriptor.model, preview);
  }
}
