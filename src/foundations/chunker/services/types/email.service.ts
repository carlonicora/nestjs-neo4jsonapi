import { Injectable, Logger } from "@nestjs/common";
import { simpleParser } from "mailparser";

export interface ParsedEmail {
  subject: string;
  from: string;
  to: string;
  cc?: string;
  date: string;
  textBody: string;
  htmlBody?: string;
  attachments: EmailAttachment[];
}

export interface EmailAttachment {
  filename: string;
  contentType: string;
  content: Buffer;
}

export interface AttachmentContent {
  filename: string;
  content: string;
}

@Injectable()
export class EmailParserService {
  private logger: Logger = new Logger(EmailParserService.name);

  async parseEml(buffer: Buffer): Promise<ParsedEmail> {
    const parsed = await simpleParser(buffer);

    const formatAddress = (addr: any): string => {
      if (!addr) return "";
      if (typeof addr === "string") return addr;
      if (addr.text) return addr.text;
      if (addr.value) {
        return addr.value.map((v: any) => v.address || v.name || "").join(", ");
      }
      return String(addr);
    };

    return {
      subject: parsed.subject || "(No Subject)",
      from: formatAddress(parsed.from),
      to: formatAddress(parsed.to),
      cc: parsed.cc ? formatAddress(parsed.cc) : undefined,
      date: parsed.date?.toISOString() || "",
      textBody: parsed.text || "",
      htmlBody: parsed.html || undefined,
      attachments: (parsed.attachments || []).map((att) => ({
        filename: att.filename || "unnamed",
        contentType: att.contentType || "application/octet-stream",
        content: att.content,
      })),
    };
  }

  async parseMsg(buffer: Buffer): Promise<ParsedEmail> {
    // Dynamic import since msgreader uses default export
    const MsgReaderModule = await import("@kenjiuno/msgreader");
    const MsgReader = MsgReaderModule.default as unknown as new (data: ArrayBuffer) => any;

    const arrayBuffer = new Uint8Array(buffer).buffer as ArrayBuffer;
    const reader = new MsgReader(arrayBuffer);
    const msgData = reader.getFileData();

    const toRecipients = (msgData.recipients || [])
      .filter((r: any) => !r.recipType || r.recipType === "to" || r.recipType === 1)
      .map((r: any) => {
        const name = r.name || "";
        const email = r.email || "";
        return email ? (name ? `${name} <${email}>` : email) : name;
      })
      .join(", ");

    const ccRecipients = (msgData.recipients || [])
      .filter((r: any) => r.recipType === "cc" || r.recipType === 2)
      .map((r: any) => {
        const name = r.name || "";
        const email = r.email || "";
        return email ? (name ? `${name} <${email}>` : email) : name;
      })
      .join(", ");

    const senderName = msgData.senderName || "";
    const senderEmail = msgData.senderEmail || "";
    const from = senderEmail ? (senderName ? `${senderName} <${senderEmail}>` : senderEmail) : senderName;

    const attachments: EmailAttachment[] = [];
    if (msgData.attachments) {
      for (const attMeta of msgData.attachments) {
        const att = reader.getAttachment(attMeta);
        if (att) {
          attachments.push({
            filename: att.fileName || "unnamed",
            contentType: "application/octet-stream",
            content: Buffer.from(att.content),
          });
        }
      }
    }

    return {
      subject: msgData.subject || "(No Subject)",
      from,
      to: toRecipients,
      cc: ccRecipients || undefined,
      date: msgData.clientSubmitTime || msgData.creationTime || "",
      textBody: msgData.body || "",
      attachments,
    };
  }

  assembleMarkdown(params: {
    subject: string;
    from: string;
    to: string;
    cc?: string;
    date: string;
    textBody: string;
    attachments: EmailAttachment[];
    attachmentContents?: AttachmentContent[];
  }): string {
    const sections: string[] = [];

    sections.push(`# Email: ${params.subject}`);
    sections.push(`**From:** ${params.from}`);
    sections.push(`**To:** ${params.to}`);
    if (params.cc) {
      sections.push(`**CC:** ${params.cc}`);
    }
    if (params.date) {
      sections.push(`**Date:** ${params.date}`);
    }

    sections.push("---");

    if (params.textBody) {
      sections.push(params.textBody);
    }

    if (params.attachmentContents && params.attachmentContents.length > 0) {
      sections.push("---");
      for (const att of params.attachmentContents) {
        sections.push(`## Attachment: ${att.filename}`);
        sections.push(att.content);
      }
    }

    return sections.join("\n\n");
  }
}
