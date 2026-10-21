import { BadRequestException, Body, Controller, HttpCode, HttpStatus, Param, Post, Query } from "@nestjs/common";
import { EmailAutomationUnsubscribeDTO } from "../dtos/email-automation-unsubscribe.dto";
import { EMAIL_AUTOMATION_UNSUBSCRIBE_SEGMENT, emailAutomationMeta } from "../entities/email-automation.meta";
import { EmailAutomationUnsubscribeService } from "../services/email-automation-unsubscribe.service";

/**
 * Public email-automation routes (no guard). Kept apart from the admin controller so the
 * literal `unsubscribe` segment never collides with `:emailAutomationId`.
 */
@Controller()
export class EmailAutomationPublicController {
  constructor(private readonly unsubscribeService: EmailAutomationUnsubscribeService) {}

  /**
   * POST /email-automations/unsubscribe/:token
   *
   * Two callers:
   * - the web page: JSON:API body `{ data: { type: EMAIL_AUTOMATION_UNSUBSCRIBE_TYPE, attributes: { scope } } }`;
   * - a mail client's RFC 8058 one-click POST: form body `List-Unsubscribe=One-Click` and `?scope=all`
   *   in the URL. The global ValidationPipe whitelist strips the form key, so `body.data` is absent.
   */
  @Post(`${emailAutomationMeta.endpoint}/${EMAIL_AUTOMATION_UNSUBSCRIBE_SEGMENT}/:token`)
  @HttpCode(HttpStatus.OK)
  async unsubscribe(
    @Param("token") token: string,
    @Query("scope") scope?: string,
    @Body() body?: EmailAutomationUnsubscribeDTO,
  ) {
    const resolvedScope = scope ?? body?.data?.attributes?.scope ?? "all";
    if (resolvedScope !== "automation" && resolvedScope !== "all") {
      throw new BadRequestException("Invalid unsubscribe scope");
    }

    return await this.unsubscribeService.unsubscribe({
      token,
      scope: resolvedScope,
      source: body?.data ? "link" : "header",
    });
  }
}
