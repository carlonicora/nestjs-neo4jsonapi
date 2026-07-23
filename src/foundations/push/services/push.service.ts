import { Injectable } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { BaseConfigInterface, ConfigVapidInterface } from "../../../config/interfaces";
import { PushSubscriptionDTO } from "../../push/dtos/subscription.push.dto";
import { Push } from "../../push/entities/push.entity";
import { PushRepository } from "../../push/repositories/push.repository";
import * as webPush from "web-push";

@Injectable()
export class PushService {
  private _isActive = true;

  constructor(
    private readonly pushRepository: PushRepository,
    private readonly configService: ConfigService<BaseConfigInterface>,
  ) {
    const vapidConfig = this.configService.get<ConfigVapidInterface>("vapid");

    if (!vapidConfig?.publicKey || !vapidConfig?.privateKey) {
      this._isActive = false;
      return;
    }

    webPush.setVapidDetails(`mailto:${vapidConfig.email}`, vapidConfig.publicKey, vapidConfig.privateKey);
  }

  async registerSubscription(params: { subscription: PushSubscriptionDTO }): Promise<void> {
    if (!this._isActive) return;

    const existingPush = await this.pushRepository.findByEndpoint({ endpoint: params.subscription.endpoint });

    if (!existingPush || !existingPush.length)
      await this.pushRepository.create({
        endpoint: params.subscription.endpoint,
        p256dh: params.subscription.keys.p256dh,
        auth: params.subscription.keys.auth,
      });
  }

  async sendNotification(params: {
    pushSubscriptions: Push[];
    title: string;
    message: string;
    url: string;
  }): Promise<void> {
    if (!this._isActive) return;

    const payload = {
      title: params.title,
      message: params.message,
      url: params.url,
    };

    await Promise.all(
      params.pushSubscriptions.map(async (pushSubscription) => {
        try {
          await webPush.sendNotification(pushSubscription.subscription, JSON.stringify(payload));
        } catch (error) {
          // 404/410 mean the subscription is permanently gone (unsubscribed or
          // expired). Prune it so we stop retrying a dead endpoint on every send.
          const statusCode = (error as webPush.WebPushError)?.statusCode;
          if (statusCode === 404 || statusCode === 410) {
            await this.pushRepository.deleteByEndpoint({ endpoint: pushSubscription.subscription.endpoint });
          } else {
            console.error("Error sending push notification", error);
          }
        }
      }),
    );
  }
}
