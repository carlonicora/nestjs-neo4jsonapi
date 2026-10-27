import { InjectQueue } from "@nestjs/bullmq";
import { BadRequestException, Injectable, NotFoundException } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { Queue } from "bullmq";
import { ClsService } from "nestjs-cls";
import { BaseConfigInterface, ConfigApiInterface, ConfigAppInterface } from "../../../config/interfaces";
import { QueueId } from "../../../config/enums/queue.id";
import { EmailService } from "../../../core/email/services/email.service";
import { JsonApiSingleDocument } from "../../../core/jsonapi/interfaces/jsonapi.document.interface";
import { JsonApiService } from "../../../core/jsonapi/services/jsonapi.service";
import { AbstractService, JsonApiDTOData } from "../../../core/neo4j/abstracts/abstract.service";
import { UserRepository } from "../../user/repositories/user.repository";
import { ResponseLanguageService } from "../../user/services/response-language.service";
import {
  EMAIL_BLAST_JOB_NAMES,
  EMAIL_BLAST_JOB_OPTIONS,
  EMAIL_BLAST_TEST_SUBJECT_PREFIX,
  EMAIL_BLAST_TEST_TOKEN,
  EmailBlastJobData,
  emailBlastJobId,
} from "../email-blast.constants";
import { EmailBlast, EmailBlastDescriptor } from "../entities/email-blast";
import { EmailBlastAudienceDescriptor } from "../entities/email-blast-audience";
import { EmailBlastAdminRepository } from "../repositories/email-blast.admin.repository";
import { EmailBlastRepository } from "../repositories/email-blast.repository";
import { renderEmailBlast } from "../utils/email-blast.renderer";

/**
 * Administrator operations on a blast: CRUD (inherited), the recipient count, the test send
 * and Send. Only a `draft` can be changed, deleted, test-sent or sent.
 */
@Injectable()
export class EmailBlastService extends AbstractService<EmailBlast, typeof EmailBlastDescriptor.relationships> {
  protected readonly descriptor = EmailBlastDescriptor;

  constructor(
    jsonApiService: JsonApiService,
    private readonly emailBlastRepository: EmailBlastRepository,
    clsService: ClsService,
    private readonly adminRepository: EmailBlastAdminRepository,
    private readonly userRepository: UserRepository,
    private readonly responseLanguage: ResponseLanguageService,
    private readonly emailService: EmailService,
    private readonly configService: ConfigService<BaseConfigInterface>,
    @InjectQueue(QueueId.EMAIL_BLAST) private readonly queue: Queue,
  ) {
    super(jsonApiService, emailBlastRepository, clsService, EmailBlastDescriptor.model);
  }

  async patchFromDTO(params: { data: JsonApiDTOData }): Promise<JsonApiSingleDocument> {
    await this.loadDraft({ id: params.data.id });
    return super.patchFromDTO(params);
  }

  async delete(params: { id: string }): Promise<void> {
    await this.loadDraft({ id: params.id });
    return super.delete(params);
  }

  /**
   * How many people the blast would reach now, as a synthetic `email-blast-audiences` resource.
   */
  async findAudience(params: { id: string }): Promise<JsonApiSingleDocument> {
    return this.jsonApiService.buildSingle(
      EmailBlastAudienceDescriptor.model,
      await this.adminRepository.countEligibleRecipients({ blastId: params.id }),
    );
  }

  /**
   * Sends the draft to the calling administrator only: subject prefixed `[TEST] `, an
   * unsubscribe token that matches nothing, and no delivery created.
   */
  async sendTest(params: { id: string }): Promise<void> {
    const blast = await this.loadDraft({ id: params.id });

    // A platform administrator belongs to no company, so the company-scoped findByUserId
    // finds nothing; the route is administrator-only, so the unscoped admin read is safe.
    const user = await this.userRepository.findOneForAdmin({ userId: this.clsService.get("userId") });
    if (!user?.email) throw new NotFoundException("User not found");

    const locale = (await this.responseLanguage.resolveForEmail({ email: user.email })) ?? "en";
    const rendered = await renderEmailBlast({
      blast,
      recipient: { email: user.email, name: user.name },
      unsubscribeToken: EMAIL_BLAST_TEST_TOKEN,
      locale,
      appUrl: this.configService.get<ConfigAppInterface>("app").url,
      apiUrl: this.configService.get<ConfigApiInterface>("api").url,
    });

    await this.emailService.sendEmail(
      "emailBlast",
      {
        to: user.email,
        subject: `${EMAIL_BLAST_TEST_SUBJECT_PREFIX}${rendered.subject}`,
        content: rendered.content,
        replyTo: rendered.replyTo,
        headers: rendered.headers,
        unsubscribeAllUrl: rendered.unsubscribeAllUrl,
      },
      locale,
    );
  }

  /**
   * Moves the draft to `sending` and queues the worker job that snapshots the recipients
   * and sends. `markSending` only matches a draft, so a second press (or a second
   * administrator) gets a 400 and never queues a second run.
   */
  async send(params: { id: string }): Promise<JsonApiSingleDocument> {
    const audience = await this.adminRepository.countEligibleRecipients({ blastId: params.id });
    if (audience.recipientCount === 0) throw new BadRequestException("Nobody can receive this blast");

    const blast = await this.emailBlastRepository.markSending({ id: params.id, sentAt: new Date() });
    if (!blast) throw new BadRequestException("This blast has already been sent");

    const data: EmailBlastJobData = { blastId: params.id };
    await this.queue.add(EMAIL_BLAST_JOB_NAMES.sendBlast, data, {
      ...EMAIL_BLAST_JOB_OPTIONS,
      jobId: emailBlastJobId(params.id),
    });

    return this.jsonApiService.buildSingle(EmailBlastDescriptor.model, blast);
  }

  private async loadDraft(params: { id: string }): Promise<EmailBlast> {
    const blast = await this.emailBlastRepository.findById({ id: params.id });
    if (!blast) throw new NotFoundException();
    if (blast.status !== "draft") throw new BadRequestException("Only a draft blast can be changed");
    return blast;
  }
}
