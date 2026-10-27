import * as Handlebars from "handlebars";

const escapeHtml = (value: string): string =>
  value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");

/**
 * Renders a Markdown email written by an administrator: the subject and the HTML body
 * fragment (`content`) that an email template wraps with the app's header and footer.
 *
 * Shared by the automation renderer and the blast renderer, so both escape the same way:
 * - plain values in `vars` are HTML-escaped by Handlebars in the body; a value wrapped in
 *   `Handlebars.SafeString` (a URL built from config and a token) is passed as is;
 * - raw HTML written in the body is escaped: the body is Markdown;
 * - the subject is a plain-text header, not HTML, so it is never escaped
 *   (escaping would show `&amp;` in the inbox).
 */
export async function renderMarkdownEmail(params: {
  subject: string;
  body: string;
  vars: Record<string, unknown>;
}): Promise<{ subject: string; content: string }> {
  const subject = Handlebars.compile(params.subject, { noEscape: true })(params.vars);

  const markdown = Handlebars.compile(params.body)(params.vars);
  const { Marked } = await import("marked");
  const marked = new Marked({ renderer: { html: ({ text }) => escapeHtml(text) } });
  const content = marked.parse(markdown, { async: false }) as string;

  return { subject, content };
}
