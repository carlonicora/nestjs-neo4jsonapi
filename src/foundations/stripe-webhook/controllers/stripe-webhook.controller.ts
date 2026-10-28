import { InjectQueue } from "@nestjs/bullmq";
import { Controller, Headers, HttpStatus, Post, Req, Res } from "@nestjs/common";
import { Queue } from "bullmq";
import { FastifyReply, FastifyRequest } from "fastify";
import { QueueId } from "../../../config/enums/queue.id";
import { AppLoggingService } from "../../../core/logging";
import { stripeWebhookEventMeta } from "../entities/stripe-webhook-event.meta";
import { StripeWebhookJobData } from "../processors/stripe-webhook.processor";
import { StripeWebhookEventRepository } from "../repositories/stripe-webhook-event.repository";
import { StripeWebhookService } from "../services/stripe-webhook.service";

@Controller()
export class StripeWebhookController {
  constructor(
    private readonly stripeWebhookService: StripeWebhookService,
    private readonly stripeWebhookEventRepository: StripeWebhookEventRepository,
    private readonly logger: AppLoggingService,
    @InjectQueue(QueueId.BILLING_WEBHOOK) private readonly webhookQueue: Queue<StripeWebhookJobData>,
  ) {}

  @Post(stripeWebhookEventMeta.endpoint)
  async handleStripeWebhook(
    @Req() req: FastifyRequest,
    @Res() reply: FastifyReply,
    @Headers("stripe-signature") signature: string,
  ) {
    try {
      if (!signature) {
        this.logger.warn("Webhook received without signature");
        return reply.status(HttpStatus.BAD_REQUEST).send({ error: "Missing stripe-signature header" });
      }

      const rawBody = (req as any).rawBody as Buffer;
      if (!rawBody) {
        this.logger.error("Raw body not available for webhook verification");
        return reply.status(HttpStatus.BAD_REQUEST).send({ error: "Raw body not available" });
      }

      const event = this.stripeWebhookService.constructEvent(rawBody, signature);
      this.stripeWebhookService.parseEvent(event);

      // Check for duplicate events (idempotency)
      const existingEvent = await this.stripeWebhookEventRepository.findByStripeEventId({
        stripeEventId: event.id,
      });

      if (existingEvent) {
        this.logger.debug(`Duplicate webhook event received: ${event.id}`);
        return reply.status(HttpStatus.OK).send({ received: true, duplicate: true });
      }

      // Store the event
      const webhookEvent = await this.stripeWebhookEventRepository.create({
        stripeEventId: event.id,
        eventType: event.type,
        livemode: event.livemode,
        apiVersion: event.api_version,
        payload: event.data.object as Record<string, any>,
      });

      // Queue the event for processing
      await this.webhookQueue.add(
        event.type,
        {
          webhookEventId: webhookEvent.id,
          stripeEventId: event.id,
          eventType: event.type,
          payload: event.data.object as Record<string, any>,
          // An upgrade's old price is only known from here: the database already holds the new one
          previousAttributes: (event.data as { previous_attributes?: Record<string, any> }).previous_attributes,
        },
        {
          attempts: 3,
          backoff: {
            type: "exponential",
            delay: 1000,
          },
          removeOnComplete: true,
          removeOnFail: false,
        },
      );

      this.logger.debug(`Webhook event queued: ${event.type} (${event.id})`);

      return reply.status(HttpStatus.OK).send({ received: true });
    } catch (error) {
      if (error instanceof Error && error.message.includes("signature")) {
        this.logger.warn(`Webhook signature verification failed: ${error.message}`);
        return reply.status(HttpStatus.BAD_REQUEST).send({ error: "Webhook signature verification failed" });
      }

      this.logger.error(`Webhook processing error: ${error instanceof Error ? error.message : "Unknown error"}`);
      return reply.status(HttpStatus.INTERNAL_SERVER_ERROR).send({ error: "Internal server error" });
    }
  }
}
