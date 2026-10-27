import { Injectable } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import * as Handlebars from "handlebars";
import { BaseConfigInterface, ConfigApiInterface, ConfigAppInterface } from "../../../config/interfaces";
import { EmailAutomation } from "../entities/email-automation";
import { EmailAutomationEnrollment } from "../entities/email-automation-enrollment";
import { EmailAutomationStep } from "../entities/email-automation-step";
import { EMAIL_AUTOMATION_UNSUBSCRIBE_SEGMENT, emailAutomationMeta } from "../entities/email-automation.meta";
import { renderMarkdownEmail } from "../utils/email-markdown.renderer";

export type EmailAutomationRendered = {
  subject: string;
  content: string;
  headers: Record<string, string>;
  replyTo?: string;
  unsubscribeUrl: string;
  unsubscribeAllUrl: string;
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

    const unsubscribeUrl = `${appUrl}${locale}/unsubscribe/${token}`;
    const unsubscribeAllUrl = `${unsubscribeUrl}?scope=all`;

    const vars = {
      name: enrollment.name ?? enrollment.email.split("@")[0],
      email: enrollment.email,
      url: new Handlebars.SafeString(appUrl),
      unsubscribeUrl: new Handlebars.SafeString(unsubscribeUrl),
      unsubscribeAllUrl: new Handlebars.SafeString(unsubscribeAllUrl),
    };

    const { subject, content } = await renderMarkdownEmail({ subject: step.subject, body: step.body, vars });

    return {
      subject,
      content,
      headers: {
        "List-Unsubscribe": `<${apiUrl}${emailAutomationMeta.endpoint}/${EMAIL_AUTOMATION_UNSUBSCRIBE_SEGMENT}/${token}?scope=all>`,
        "List-Unsubscribe-Post": "List-Unsubscribe=One-Click",
      },
      ...(automation.replyTo ? { replyTo: automation.replyTo } : {}),
      unsubscribeUrl,
      unsubscribeAllUrl,
    };
  }
}
