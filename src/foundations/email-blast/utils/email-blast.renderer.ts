import * as Handlebars from "handlebars";
import { renderMarkdownEmail } from "../../email-automation/utils/email-markdown.renderer";
import { resolveEmailPurpose } from "../../email-automation/utils/email-purpose";
import { EmailBlast } from "../entities/email-blast";
import { EMAIL_BLAST_UNSUBSCRIBE_SEGMENT, emailBlastMeta } from "../entities/email-blast.meta";

export type EmailBlastRendered = {
  subject: string;
  content: string;
  headers: Record<string, string>;
  replyTo?: string;
  /** Undefined for a Service blast: it carries no unsubscribe link. */
  unsubscribeAllUrl?: string;
  isService: boolean;
};

/**
 * Renders a blast for one recipient: the subject and the HTML body fragment (`content`)
 * that the `emailBlast` template wraps with the app's header, the unsubscribe link and
 * the footer.
 *
 * Variables: `{{name}}`, `{{email}}`, `{{url}}`, `{{unsubscribeAllUrl}}`.
 * `name` and `email` are HTML-escaped; the two URLs are built from config and a UUID
 * token, so they are passed unescaped. The caller reads `appUrl` / `apiUrl` from config.
 *
 * A Service blast (purpose "service") has no `unsubscribeAllUrl` (a body that uses it
 * renders an empty string) and no List-Unsubscribe headers. A missing purpose counts
 * as Marketing.
 */
export async function renderEmailBlast(params: {
  blast: EmailBlast;
  recipient: { email: string; name?: string };
  unsubscribeToken: string;
  locale: string;
  appUrl: string;
  apiUrl: string;
}): Promise<EmailBlastRendered> {
  const { blast, recipient, unsubscribeToken, locale, appUrl, apiUrl } = params;

  const isService = resolveEmailPurpose(blast.purpose) === "service";
  const unsubscribeAllUrl = isService ? undefined : `${appUrl}${locale}/unsubscribe/blast/${unsubscribeToken}`;

  const vars = {
    name: recipient.name ?? recipient.email.split("@")[0],
    email: recipient.email,
    url: new Handlebars.SafeString(appUrl),
    ...(unsubscribeAllUrl ? { unsubscribeAllUrl: new Handlebars.SafeString(unsubscribeAllUrl) } : {}),
  };

  const { subject, content } = await renderMarkdownEmail({ subject: blast.subject, body: blast.body, vars });

  return {
    subject,
    content,
    headers: isService
      ? {}
      : {
          "List-Unsubscribe": `<${apiUrl}${emailBlastMeta.endpoint}/${EMAIL_BLAST_UNSUBSCRIBE_SEGMENT}/${unsubscribeToken}>`,
          "List-Unsubscribe-Post": "List-Unsubscribe=One-Click",
        },
    ...(blast.replyTo ? { replyTo: blast.replyTo } : {}),
    ...(unsubscribeAllUrl ? { unsubscribeAllUrl } : {}),
    isService,
  };
}
