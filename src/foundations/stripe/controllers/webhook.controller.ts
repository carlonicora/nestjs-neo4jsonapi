import { InjectQueue } from "@nestjs/bullmq";
import { Controller, Headers, HttpStatus, Post, Req, Res } from "@nestjs/common";
import { Queue } from "bullmq";
import { FastifyReply, FastifyRequest } from "fastify";
import { AppLoggingService } from "@carlonicora/nestjs-neo4jsonapi";
import { StripeWebhookService } from "@carlonicora/nestjs-neo4jsonapi";
import { WebhookJobData } from "../processors/webhook.processor";
import { WebhookEventRepository } from "../repositories/webhook-event.repository";

@Controller("billing/webhooks")
export class WebhookController {
  constructor(
    private readonly stripeWebhookService: StripeWebhookService,
    private readonly webhookEventRepository: WebhookEventRepository,
    private readonly logger: AppLoggingService,
    @InjectQueue(`${process.env.QUEUE}_billing_webhook`) private readonly webhookQueue: Queue<WebhookJobData>,
  ) {}

  @Post("stripe")
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
      const existingEvent = await this.webhookEventRepository.findByStripeEventId({
        stripeEventId: event.id,
      });

      if (existingEvent) {
        this.logger.debug(`Duplicate webhook event received: ${event.id}`);
        return reply.status(HttpStatus.OK).send({ received: true, duplicate: true });
      }

      // Store the event
      const webhookEvent = await this.webhookEventRepository.create({
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
