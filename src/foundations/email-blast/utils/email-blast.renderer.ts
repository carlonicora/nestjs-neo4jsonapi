import * as Handlebars from "handlebars";
import { renderMarkdownEmail } from "../../email-automation/utils/email-markdown.renderer";
import { EmailBlast } from "../entities/email-blast";
import { EMAIL_BLAST_UNSUBSCRIBE_SEGMENT, emailBlastMeta } from "../entities/email-blast.meta";

export type EmailBlastRendered = {
  subject: string;
  content: string;
  headers: Record<string, string>;
  replyTo?: string;
  unsubscribeAllUrl: string;
};

/**
 * Renders a blast for one recipient: the subject and the HTML body fragment (`content`)
 * that the `emailBlast` template wraps with the app's header, the unsubscribe link and
 * the footer.
 *
 * Variables: `{{name}}`, `{{email}}`, `{{url}}`, `{{unsubscribeAllUrl}}`.
 * `name` and `email` are HTML-escaped; the two URLs are built from config and a UUID
 * token, so they are passed unescaped. The caller reads `appUrl` / `apiUrl` from config.
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

  const unsubscribeAllUrl = `${appUrl}${locale}/unsubscribe/blast/${unsubscribeToken}`;

  const vars = {
    name: recipient.name ?? recipient.email.split("@")[0],
    email: recipient.email,
    url: new Handlebars.SafeString(appUrl),
    unsubscribeAllUrl: new Handlebars.SafeString(unsubscribeAllUrl),
  };

  const { subject, content } = await renderMarkdownEmail({ subject: blast.subject, body: blast.body, vars });

  return {
    subject,
    content,
    headers: {
      "List-Unsubscribe": `<${apiUrl}${emailBlastMeta.endpoint}/${EMAIL_BLAST_UNSUBSCRIBE_SEGMENT}/${unsubscribeToken}>`,
      "List-Unsubscribe-Post": "List-Unsubscribe=One-Click",
    },
    ...(blast.replyTo ? { replyTo: blast.replyTo } : {}),
    unsubscribeAllUrl,
  };
}
