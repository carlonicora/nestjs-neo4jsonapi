import { Body, Controller, HttpCode, HttpStatus, Param, Post, Req } from "@nestjs/common";
import { CacheInvalidate } from "../../../common/decorators/cache-invalidate.decorator";
import type { AuthenticatedRequest } from "../../../common/interfaces/authenticated.request.interface";
import { CacheService } from "../../../core/cache/services/cache.service";
import { EmailBlastUnsubscribeDTO } from "../dtos/email-blast-unsubscribe.dto";
import { EMAIL_BLAST_UNSUBSCRIBE_SEGMENT, emailBlastMeta } from "../entities/email-blast.meta";
import { EmailBlastDeliveryService } from "../services/email-blast-delivery.service";

/**
 * Public email-blast routes (no guard). Kept apart from the admin controller so the
 * literal `unsubscribe` segment never collides with `:emailBlastId`.
 */
@Controller()
export class EmailBlastPublicController {
  constructor(
    private readonly deliveryService: EmailBlastDeliveryService,
    private readonly cacheService: CacheService,
  ) {}

  /**
   * POST /email-blasts/unsubscribe/:token — answers 204 with no body, so a token holder
   * never receives the delivery's email or user id.
   *
   * Two callers:
   * - the web page: JSON:API body `{ data: { type: EMAIL_BLAST_UNSUBSCRIBE_TYPE } }`;
   * - a mail client's RFC 8058 one-click POST: form body `List-Unsubscribe=One-Click`. The
   *   global ValidationPipe whitelist strips the form key, so `body.data` is absent.
   */
  @Post(`${emailBlastMeta.endpoint}/${EMAIL_BLAST_UNSUBSCRIBE_SEGMENT}/:token`)
  @HttpCode(HttpStatus.NO_CONTENT)
  @CacheInvalidate(emailBlastMeta)
  async unsubscribe(
    @Req() request: AuthenticatedRequest,
    @Param("token") token: string,
    @Body() body?: EmailBlastUnsubscribeDTO,
  ): Promise<void> {
    await this.deliveryService.unsubscribe({ token, source: body?.data ? "link" : "header" });
  }
}
