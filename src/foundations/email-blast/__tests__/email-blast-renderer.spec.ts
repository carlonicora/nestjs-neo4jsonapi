import { describe, expect, it } from "vitest";
import { EmailBlast } from "../entities/email-blast";
import { EMAIL_BLAST_UNSUBSCRIBE_SEGMENT, emailBlastMeta } from "../entities/email-blast.meta";
import { renderEmailBlast } from "../utils/email-blast.renderer";

describe("renderEmailBlast", () => {
  const blast = {
    id: "blast-1",
    subject: "News for {{name}}",
    body: "Hello {{name}} ({{email}}), visit {{url}} or stop: {{unsubscribeAllUrl}}",
    status: "draft",
    replyTo: "reply@wyrd.li",
    sentCount: 0,
    failedCount: 0,
    unsubscribedCount: 0,
  } as EmailBlast;

  const base = {
    blast,
    recipient: { email: "gm@wyrd.li", name: "Carlo" },
    unsubscribeToken: "tok-1",
    locale: "en",
    appUrl: "https://app.test/",
    apiUrl: "https://api.test/",
  };

  it("renders name, email, url and unsubscribeAllUrl", async () => {
    const result = await renderEmailBlast(base);

    expect(result.subject).toBe("News for Carlo");
    // marked autolinks the bare address, as it does for automation emails
    expect(result.content).toContain('Hello Carlo (<a href="mailto:gm@wyrd.li">gm@wyrd.li</a>)');
    expect(result.content).toContain("https://app.test/");
    expect(result.content).toContain("https://app.test/en/unsubscribe/blast/tok-1");
    expect(result.unsubscribeAllUrl).toBe("https://app.test/en/unsubscribe/blast/tok-1");
    expect(result.replyTo).toBe("reply@wyrd.li");
  });

  it("falls back to the part of the email before @ when there is no name", async () => {
    const result = await renderEmailBlast({ ...base, recipient: { email: "gm@wyrd.li" } });

    expect(result.subject).toBe("News for gm");
  });

  it("escapes raw HTML in the body", async () => {
    const result = await renderEmailBlast({
      ...base,
      blast: { ...blast, body: "**Bold** <script>alert(1)</script>" } as EmailBlast,
    });

    expect(result.content).toContain("<strong>Bold</strong>");
    expect(result.content).not.toContain("<script>");
    expect(result.content).toContain("&lt;script&gt;");
  });

  it("does not escape the subject", async () => {
    const result = await renderEmailBlast({
      ...base,
      blast: { ...blast, subject: "Tips & tricks for {{name}}" } as EmailBlast,
      recipient: { email: "gm@wyrd.li", name: "A & B" },
    });

    expect(result.subject).toBe("Tips & tricks for A & B");
  });

  it("List-Unsubscribe points at the blast public route", async () => {
    const result = await renderEmailBlast(base);

    expect(result.headers).toEqual({
      "List-Unsubscribe": `<https://api.test/${emailBlastMeta.endpoint}/${EMAIL_BLAST_UNSUBSCRIBE_SEGMENT}/tok-1>`,
      "List-Unsubscribe-Post": "List-Unsubscribe=One-Click",
    });
  });
});
