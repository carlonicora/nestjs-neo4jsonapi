import { Injectable } from "@nestjs/common";
import * as fs from "fs";
import * as Handlebars from "handlebars";
import * as nodemailer from "nodemailer";
import { join } from "path";
import { baseConfig } from "../../../config/base.config";
import sendGridMail = require("@sendgrid/mail");

export interface EmailParams {
  to: string | string[];
  subject?: string;
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
  private readonly emailConfig = baseConfig.email;
  private readonly appConfig = baseConfig.app;

  constructor() {
    // App templates (overrides)
    this.templateBasePath = join(process.cwd(), "templates", "email");

    // Library templates (defaults)
    this.libraryTemplateBasePath = join(__dirname, "../templates");

    // Register eq helper for template conditionals
    Handlebars.registerHelper("eq", (a: any, b: any) => a === b);

    const headerPath = join(this.templateBasePath, "header.hbs");
    const footerPath = join(this.templateBasePath, "footer.hbs");

    if (fs.existsSync(headerPath)) {
      const headerPartial = fs.readFileSync(headerPath, "utf8");
      Handlebars.registerPartial("header", headerPartial);
    } else {
      console.error(`Partial header.hbs not found in ${this.templateBasePath}`);
    }
    if (fs.existsSync(footerPath)) {
      const footerPartial = fs.readFileSync(footerPath, "utf8");
      Handlebars.registerPartial("footer", footerPartial);
    } else {
      console.error(`Partial footer.hbs not found in ${this.templateBasePath}`);
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
    if (!emailParams.url && this.appConfig) emailParams.url = this.appConfig.url;

    let html: string;
    try {
      const template = Handlebars.compile(templateContent);
      html = template(emailParams);
    } catch (error) {
      console.error("Error compiling Handlebars template:", error);
      throw new Error("Failed to compile email template");
    }

    const titleMatch = html.match(/<title>(.*?)<\/title>/);
    const extractedTitle = titleMatch ? titleMatch[1] : "";
    const to = emailParams.to;
    const subject = emailParams.subject || extractedTitle;

    try {
      if (this.emailConfig.emailProvider === "brevo") {
        await this.sendEmailWithBrevo(to, subject, html);
      } else if (this.emailConfig.emailProvider === "sendgrid") {
        await this.sendEmailWithSendGrid(to, subject, html);
      } else {
        await this.sendEmailWithSmtp(to, subject, html);
      }
    } catch (error) {
      console.error("Error sending email:", error);
      throw error;
    }
  }
  private async sendEmailWithBrevo(to: string | string[], subject: string, html: string): Promise<void> {
    const { TransactionalEmailsApi, TransactionalEmailsApiApiKeys, SendSmtpEmail } = require("@getbrevo/brevo");
    const apiInstance = new TransactionalEmailsApi();

    // Brevo SDK v3 uses setApiKey method for authentication
    apiInstance.setApiKey(TransactionalEmailsApiApiKeys.apiKey, this.emailConfig.emailApiKey);

    const sendSmtpEmail = new SendSmtpEmail();

    sendSmtpEmail.subject = subject;
    sendSmtpEmail.htmlContent = html;
    sendSmtpEmail.sender = this.convertToEmailAddressArray(this.emailConfig.emailFrom)[0];
    sendSmtpEmail.to = this.convertToEmailAddressArray(to);

    try {
      await apiInstance.sendTransacEmail(sendSmtpEmail);
    } catch (error) {
      console.error(error);
      throw error;
    }
  }

  private async sendEmailWithSendGrid(to: string | string[], subject: string, html: string): Promise<void> {
    if (!this.emailConfig.emailApiKey) {
      throw new Error("SendGrid API key is not configured");
    }
    sendGridMail.setApiKey(this.emailConfig.emailApiKey);
    const mailOptions = {
      to: to,
      from: this.emailConfig.emailFrom,
      subject: subject,
      text: html,
      html: html,
    };

    try {
      await sendGridMail.send(mailOptions);
    } catch (error) {
      console.error("Error sending email:", error);
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

  private async sendEmailWithSmtp(to: string | string[], subject: string, html: string): Promise<void> {
    const transporter = nodemailer.createTransport({
      host: this.emailConfig.emailHost,
      port: this.emailConfig.emailPort,
      secure: this.emailConfig.emailSecure,
      auth: {
        user: this.emailConfig.emailUsername,
        pass: this.emailConfig.emailPassword,
      },
    });

    const mailOptions = {
      from: this.emailConfig.emailFrom,
      to: to,
      subject: subject,
      html: html,
    };

    try {
      await transporter.sendMail(mailOptions);
    } catch (error) {
      console.error("Error sending SMTP email:", error);
      throw error;
    }
  }
}
