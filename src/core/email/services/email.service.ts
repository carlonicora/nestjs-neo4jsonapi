import { Injectable } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import * as fs from "fs";
import * as Handlebars from "handlebars";
import * as nodemailer from "nodemailer";
import { join } from "path";
import { BaseConfigInterface } from "../../../config/interfaces/base.config.interface";
import { ConfigAppInterface } from "../../../config/interfaces/config.app.interface";
import { ConfigEmailInterface } from "../../../config/interfaces/config.email.interface";
import { AppLoggingService } from "../../logging/services/logging.service";
import sendGridMail = require("@sendgrid/mail");

export interface EmailAttachment {
  filename: string;
  content: Buffer;
  contentType: string;
}

export interface EmailParams {
  to: string | string[];
  subject?: string;
  attachments?: EmailAttachment[];
  [key: string]: any;
}

type EmailAddress = {
  name: string;
  email: string;
};

@Injectable()
export class EmailService {
  private templateBasePath: string;
  private libraryTemplateBasePath: string;

  constructor(
    private readonly config: ConfigService<BaseConfigInterface>,
    private readonly logger: AppLoggingService,
  ) {
    // App templates (overrides)
    this.templateBasePath = join(process.cwd(), "templates", "email");

    // Library templates (defaults)
    this.libraryTemplateBasePath = join(__dirname, "../templates");

    // Register eq helper for template conditionals
    Handlebars.registerHelper("eq", (a: any, b: any) => a === b);

    // Register concat helper for templates (last arg is Handlebars options)
    Handlebars.registerHelper("concat", (...args) => args.slice(0, -1).join(""));

    const headerPath = join(this.templateBasePath, "header.hbs");
    const footerPath = join(this.templateBasePath, "footer.hbs");

    if (fs.existsSync(headerPath)) {
      const headerPartial = fs.readFileSync(headerPath, "utf8");
      Handlebars.registerPartial("header", headerPartial);
    } else {
      this.logger.error(`Partial header.hbs not found in ${this.templateBasePath}`, undefined, "EmailService");
    }
    if (fs.existsSync(footerPath)) {
      const footerPartial = fs.readFileSync(footerPath, "utf8");
      Handlebars.registerPartial("footer", footerPartial);
    } else {
      this.logger.error(`Partial footer.hbs not found in ${this.templateBasePath}`, undefined, "EmailService");
    }
  }

  private loadTemplate(templateId: string, locale: string): string {
    // Try app templates first (override)
    const appTemplatePath = join(this.templateBasePath, locale, `${templateId}.hbs`);
    const appFallbackPath = join(this.templateBasePath, "en", `${templateId}.hbs`);

    // Try library templates as fallback (default)
    const libraryTemplatePath = join(this.libraryTemplateBasePath, locale, `${templateId}.hbs`);
    const libraryFallbackPath = join(this.libraryTemplateBasePath, "en", `${templateId}.hbs`);

    let templatePath: string | null = null;

    // Check in order: app locale → app en → library locale → library en
    if (fs.existsSync(appTemplatePath)) {
      templatePath = appTemplatePath;
    } else if (locale !== "en" && fs.existsSync(appFallbackPath)) {
      templatePath = appFallbackPath;
    } else if (fs.existsSync(libraryTemplatePath)) {
      templatePath = libraryTemplatePath;
    } else if (locale !== "en" && fs.existsSync(libraryFallbackPath)) {
      templatePath = libraryFallbackPath;
    }

    if (!templatePath) {
      throw new Error(
        `Template file not found for template "${templateId}" in locale "${locale}" or default "en". ` +
          `Checked app (${this.templateBasePath}) and library (${this.libraryTemplateBasePath}).`,
      );
    }

    // Load unsubscribe partial if exists
    let unsubscribePath = join(this.templateBasePath, locale, "unsubscribe.hbs");
    if (!fs.existsSync(unsubscribePath) && locale !== "en") {
      unsubscribePath = join(this.templateBasePath, "en", "unsubscribe.hbs");
    }
    if (fs.existsSync(unsubscribePath)) {
      const unsubscribePartial = fs.readFileSync(unsubscribePath, "utf8");
      Handlebars.registerPartial("unsubscribe", unsubscribePartial);
    }

    return fs.readFileSync(templatePath, "utf8");
  }

  async sendEmail(templateId: string, emailParams: EmailParams, locale: string): Promise<void> {
    const templateContent = this.loadTemplate(templateId, locale);
    const appConfig = this.config.get<ConfigAppInterface>("app");
    if (!emailParams.url && appConfig) emailParams.url = appConfig.url;

    // Capture attachments before template compilation — Handlebars must not
    // see Buffer values. Clone to avoid mutating the caller's object.
    const attachments = emailParams.attachments;
    const templateParams = { ...emailParams };
    delete templateParams.attachments;

    let html: string;
    try {
      const template = Handlebars.compile(templateContent);
      html = template(templateParams);
    } catch (error) {
      this.logger.error("Error compiling Handlebars template", error, "EmailService");
      throw new Error("Failed to compile email template");
    }

    const titleMatch = html.match(/<title>(.*?)<\/title>/);
    const extractedTitle = titleMatch ? titleMatch[1] : "";
    const to = emailParams.to;
    const subject = emailParams.subject || extractedTitle;

    try {
      const emailConfig = this.config.get<ConfigEmailInterface>("email");
      if (emailConfig.emailProvider === "brevo") {
        await this.sendEmailWithBrevo(to, subject, html);
      } else if (emailConfig.emailProvider === "sendgrid") {
        await this.sendEmailWithSendGrid(to, subject, html, attachments);
      } else {
        await this.sendEmailWithSmtp(to, subject, html, attachments);
      }
    } catch (error) {
      this.logger.error("Error sending email", error, "EmailService");
      throw error;
    }
  }
  private async sendEmailWithBrevo(to: string | string[], subject: string, html: string): Promise<void> {
    const emailConfig = this.config.get<ConfigEmailInterface>("email");
    const { TransactionalEmailsApi, TransactionalEmailsApiApiKeys, SendSmtpEmail } = require("@getbrevo/brevo");
    const apiInstance = new TransactionalEmailsApi();

    // Brevo SDK v3 uses setApiKey method for authentication
    apiInstance.setApiKey(TransactionalEmailsApiApiKeys.apiKey, emailConfig.emailApiKey);

    const sendSmtpEmail = new SendSmtpEmail();

    sendSmtpEmail.subject = subject;
    sendSmtpEmail.htmlContent = html;
    sendSmtpEmail.sender = this.convertToEmailAddressArray(emailConfig.emailFrom)[0];
    sendSmtpEmail.to = this.convertToEmailAddressArray(to);

    try {
      await apiInstance.sendTransacEmail(sendSmtpEmail);
    } catch (error) {
      this.logger.error("Error sending email via Brevo", error, "EmailService");
      throw error;
    }
  }

  private async sendEmailWithSendGrid(
    to: string | string[],
    subject: string,
    html: string,
    attachments?: EmailAttachment[],
  ): Promise<void> {
    const emailConfig = this.config.get<ConfigEmailInterface>("email");
    if (!emailConfig.emailApiKey) {
      throw new Error("SendGrid API key is not configured");
    }
    sendGridMail.setApiKey(emailConfig.emailApiKey);
    const mailOptions: Parameters<typeof sendGridMail.send>[0] = {
      to: to,
      from: emailConfig.emailFrom,
      subject: subject,
      text: html,
      html: html,
      ...(attachments && attachments.length > 0
        ? {
            attachments: attachments.map((a) => ({
              content: a.content.toString("base64"),
              filename: a.filename,
              type: a.contentType,
              disposition: "attachment",
            })),
          }
        : {}),
    };

    try {
      await sendGridMail.send(mailOptions);
    } catch (error) {
      this.logger.error("Error sending email via SendGrid", error, "EmailService", {
        sendGridErrors: error.response?.body?.errors,
      });
      throw error;
    }
  }

  private convertToEmailAddressArray(email: string | string[]): EmailAddress[] {
    const convert = (email: string): EmailAddress => {
      if (!email.includes("<")) {
        return {
          name: email,
          email: email,
        };
      }
      const [name, emailAddress] = email.split("<").map((part) => part.trim());
      return {
        name: name,
        email: emailAddress.replace(">", ""),
      };
    };

    if (typeof email === "string") {
      return [convert(email)];
    } else if (Array.isArray(email)) {
      return email.map((singleEmail) => {
        return convert(singleEmail);
      });
    } else {
      throw new Error("Invalid email address format");
    }
  }

  private async sendEmailWithSmtp(
    to: string | string[],
    subject: string,
    html: string,
    attachments?: EmailAttachment[],
  ): Promise<void> {
    const emailConfig = this.config.get<ConfigEmailInterface>("email");
    const transporter = nodemailer.createTransport({
      host: emailConfig.emailHost,
      port: emailConfig.emailPort,
      secure: emailConfig.emailSecure,
      auth: {
        user: emailConfig.emailUsername,
        pass: emailConfig.emailPassword,
      },
    });

    const mailOptions: nodemailer.SendMailOptions = {
      from: emailConfig.emailFrom,
      to: to,
      subject: subject,
      html: html,
      ...(attachments && attachments.length > 0
        ? {
            attachments: attachments.map((a) => ({
              filename: a.filename,
              content: a.content,
              contentType: a.contentType,
            })),
          }
        : {}),
    };

    try {
      await transporter.sendMail(mailOptions);
    } catch (error) {
      this.logger.error("Error sending SMTP email", error, "EmailService");
      throw error;
    }
  }
}
