import { vi, describe, it, expect, beforeEach } from "vitest";
import type { MockedObject } from "vitest";
import { ConfigService } from "@nestjs/config";
import { BaseConfigInterface } from "../../../config/interfaces";
import { EmailAutomation } from "../entities/email-automation";
import { EmailAutomationEnrollment } from "../entities/email-automation-enrollment";
import { EmailAutomationStep } from "../entities/email-automation-step";
import { EMAIL_AUTOMATION_UNSUBSCRIBE_SEGMENT, emailAutomationMeta } from "../entities/email-automation.meta";
import { EmailAutomationRenderer } from "../services/email-automation-renderer.service";

describe("EmailAutomationRenderer", () => {
  let configService: MockedObject<ConfigService<BaseConfigInterface>>;
  let renderer: EmailAutomationRenderer;

  const step = {
    id: "step-1",
    subject: "Hi {{name}}",
    body: "**Bold** {{email}} <script>",
    delayHours: 0,
  } as EmailAutomationStep;
  const enrollment = {
    id: "enr-1",
    email: "gm@wyrd.li",
    name: undefined,
    unsubscribeToken: "tok",
  } as unknown as EmailAutomationEnrollment;
  const automation = { id: "auto-1", name: "Welcome", isActive: true, replyTo: "reply@wyrd.li" } as EmailAutomation;

  beforeEach(() => {
    configService = {
      get: vi.fn((key: string) => {
        if (key === "app") return { url: "https://app.test/" };
        if (key === "api") return { url: "https://api.test/" };
        return undefined;
      }),
    } as unknown as MockedObject<ConfigService<BaseConfigInterface>>;
    renderer = new EmailAutomationRenderer(configService);
  });

  it("renders the subject with the name falling back to the part of the email before @", async () => {
    const result = await renderer.render({ step, enrollment, automation, locale: "en" });

    expect(result.subject).toBe("Hi gm");
  });

  it("uses the enrolment name when present", async () => {
    const result = await renderer.render({
      step,
      enrollment: { ...enrollment, name: "Carlo" } as EmailAutomationEnrollment,
      automation,
      locale: "en",
    });

    expect(result.subject).toBe("Hi Carlo");
  });

  it("renders Markdown to HTML with the variables and no raw HTML", async () => {
    const result = await renderer.render({ step, enrollment, automation, locale: "en" });

    expect(result.content).toContain("<strong>Bold</strong>");
    expect(result.content).toContain("gm@wyrd.li");
    expect(result.content).not.toContain("<script>");
    expect(result.content).toContain("&lt;script&gt;");
  });

  it("escapes a recipient name that carries markup", async () => {
    const result = await renderer.render({
      step: { ...step, body: "Hello {{name}}" } as EmailAutomationStep,
      enrollment: { ...enrollment, name: "<b>x</b>" } as EmailAutomationEnrollment,
      automation,
      locale: "en",
    });

    expect(result.content).not.toContain("<b>");
    expect(result.content).toContain("&lt;b&gt;x&lt;/b&gt;");
  });

  it("keeps URL variables usable in Markdown links and autolinks", async () => {
    const result = await renderer.render({
      step: {
        ...step,
        body: "[Stop]({{unsubscribeAllUrl}}) <{{unsubscribeAllUrl}}> [Open]({{url}})",
      } as EmailAutomationStep,
      enrollment,
      automation,
      locale: "en",
    });

    expect(result.content).toContain('<a href="https://app.test/en/unsubscribe/tok?scope=all">Stop</a>');
    expect(result.content).toContain(
      '<a href="https://app.test/en/unsubscribe/tok?scope=all">https://app.test/en/unsubscribe/tok?scope=all</a>',
    );
    expect(result.content).toContain('<a href="https://app.test/">Open</a>');
  });

  it("builds the unsubscribe links from the app url, the locale and the token", async () => {
    const result = await renderer.render({ step, enrollment, automation, locale: "en" });

    expect(result.unsubscribeUrl).toBe("https://app.test/en/unsubscribe/tok");
    expect(result.unsubscribeAllUrl).toBe("https://app.test/en/unsubscribe/tok?scope=all");
    expect(result.unsubscribeAllUrl.endsWith("?scope=all")).toBe(true);
  });

  it("sets the one-click List-Unsubscribe headers on the api url", async () => {
    const result = await renderer.render({ step, enrollment, automation, locale: "en" });

    expect(result.headers).toEqual({
      "List-Unsubscribe": `<https://api.test/${emailAutomationMeta.endpoint}/${EMAIL_AUTOMATION_UNSUBSCRIBE_SEGMENT}/tok?scope=all>`,
      "List-Unsubscribe-Post": "List-Unsubscribe=One-Click",
    });
  });

  it("returns the automation reply-to, and none when the automation has none", async () => {
    const withReplyTo = await renderer.render({ step, enrollment, automation, locale: "en" });
    const withoutReplyTo = await renderer.render({
      step,
      enrollment,
      automation: { ...automation, replyTo: undefined } as EmailAutomation,
      locale: "en",
    });

    expect(withReplyTo.replyTo).toBe("reply@wyrd.li");
    expect(withoutReplyTo).not.toHaveProperty("replyTo");
  });

  it("does not HTML-escape the plain-text subject", async () => {
    const result = await renderer.render({
      step,
      enrollment: { ...enrollment, name: "Tom & Jerry" } as EmailAutomationEnrollment,
      automation,
      locale: "en",
    });

    expect(result.subject).toBe("Hi Tom & Jerry");
  });
});
