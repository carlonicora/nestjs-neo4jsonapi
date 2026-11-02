import { Injectable } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import * as Handlebars from "handlebars";
import { BaseConfigInterface, ConfigApiInterface, ConfigAppInterface } from "../../../config/interfaces";
import { EmailAutomation } from "../entities/email-automation";
import { EmailAutomationEnrollment } from "../entities/email-automation-enrollment";
import { EmailAutomationStep } from "../entities/email-automation-step";
import { EMAIL_AUTOMATION_UNSUBSCRIBE_SEGMENT, emailAutomationMeta } from "../entities/email-automation.meta";
import { renderMarkdownEmail } from "../utils/email-markdown.renderer";
import { resolveEmailPurpose } from "../utils/email-purpose";

export type EmailAutomationRendered = {
  subject: string;
  content: string;
  headers: Record<string, string>;
  replyTo?: string;
  unsubscribeUrl: string;
  /** Undefined for a Service automation: the global opt-out does not stop Service emails. */
  unsubscribeAllUrl?: string;
  isService: boolean;
  isWaitlistRecipient: boolean;
};

/**
 * Renders one automation step for one enrolment: the subject and the HTML body
 * fragment (`content`) that the `emailAutomation` template wraps with the app's
 * header, the unsubscribe links and the footer.
 *
 * Variables: `{{name}}`, `{{email}}`, `{{url}}`, `{{unsubscribeUrl}}`, `{{unsubscribeAllUrl}}`.
 * `name` and `email` are HTML-escaped, so a recipient value can never inject markup.
 * The three URLs are built here from config and a UUID token, so they are passed
 * unescaped: escaping would turn `?scope=all` into `?scope&#x3D;all`, which breaks
 * Markdown autolinks. Raw HTML written in the body is escaped too: the body is Markdown.
 *
 * A Service automation (purpose "service") has no `unsubscribeAllUrl`: the variable is
 * omitted, so a body that uses it renders an empty string, and the List-Unsubscribe
 * header points at the enrolment's own unsubscribe (no `?scope=all`). A missing purpose
 * counts as Marketing.
 */
@Injectable()
export class EmailAutomationRenderer {
  constructor(private readonly configService: ConfigService<BaseConfigInterface>) {}

  async render(params: {
    step: EmailAutomationStep;
    enrollment: EmailAutomationEnrollment;
    automation: EmailAutomation;
    locale: string;
  }): Promise<EmailAutomationRendered> {
    const { step, enrollment, automation, locale } = params;
    const appUrl = this.configService.get<ConfigAppInterface>("app").url;
    const apiUrl = this.configService.get<ConfigApiInterface>("api").url;
    const token = enrollment.unsubscribeToken;

    const isService = resolveEmailPurpose(automation.purpose) === "service";
    const isWaitlistRecipient = enrollment.recipientType === "waitlist";

    const unsubscribeUrl = `${appUrl}${locale}/unsubscribe/${token}`;
    const unsubscribeAllUrl = isService ? undefined : `${unsubscribeUrl}?scope=all`;
    const oneClickUrl = `${apiUrl}${emailAutomationMeta.endpoint}/${EMAIL_AUTOMATION_UNSUBSCRIBE_SEGMENT}/${token}`;

    const vars = {
      name: enrollment.name ?? enrollment.email.split("@")[0],
      email: enrollment.email,
      url: new Handlebars.SafeString(appUrl),
      unsubscribeUrl: new Handlebars.SafeString(unsubscribeUrl),
      ...(unsubscribeAllUrl ? { unsubscribeAllUrl: new Handlebars.SafeString(unsubscribeAllUrl) } : {}),
    };

    const { subject, content } = await renderMarkdownEmail({ subject: step.subject, body: step.body, vars });

    return {
      subject,
      content,
      headers: {
        // The scope is always explicit: the one-click endpoint falls back to "all" when none is given.
        "List-Unsubscribe": isService ? `<${oneClickUrl}?scope=automation>` : `<${oneClickUrl}?scope=all>`,
        "List-Unsubscribe-Post": "List-Unsubscribe=One-Click",
      },
      ...(automation.replyTo ? { replyTo: automation.replyTo } : {}),
      unsubscribeUrl,
      ...(unsubscribeAllUrl ? { unsubscribeAllUrl } : {}),
      isService,
      isWaitlistRecipient,
    };
  }
}
