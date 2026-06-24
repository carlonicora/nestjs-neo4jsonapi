import { Entity, defineEntity } from "../../../common";
import type { Company } from "../../company/entities/company";
import type { Assistant } from "../../assistant/entities/assistant";
import { assistantMeta } from "../../assistant/entities/assistant.meta";
import type { AssistantMessage } from "../../assistant-message/entities/assistant-message";
import { assistantMessageMeta } from "../../assistant-message/entities/assistant-message.meta";
import { assistantActionMeta } from "./assistant-action.meta";

export type AssistantActionStatus = "pending" | "approved" | "denied" | "expired" | "executed" | "failed";

/**
 * AssistantAction — a durable, first-class record of a destructive tool call
 * awaiting (or having received) human approval. Survives Redis checkpoint loss
 * and acts as the audit trail for operator approval gates.
 *
 * `requestedAt` is intentionally NOT a field — the framework's `createdAt`
 * covers it.
 */
export type AssistantAction = Entity & {
  status: AssistantActionStatus;
  toolName: string;
  toolArgs: string; // JSON string
  summary: string;
  threadId: string;
  userModuleIds: string; // JSON string
  contentScope?: string; // JSON string, nullable
  resolvedAt?: string; // datetime
  expiresAt: string; // datetime
  company: Company;
  assistant: Assistant;
  message?: AssistantMessage;
};

export const AssistantActionDescriptor = defineEntity<AssistantAction>()({
  ...assistantActionMeta,
  isCompanyScoped: true,
  fields: {
    status: { type: "string" },
    toolName: { type: "string" },
    toolArgs: { type: "string" },
    summary: { type: "string" },
    threadId: { type: "string" },
    userModuleIds: { type: "string" },
    contentScope: { type: "string" },
    resolvedAt: { type: "datetime" },
    expiresAt: { type: "datetime", required: true },
  },
  relationships: {
    assistant: {
      model: assistantMeta,
      direction: "in", // the Assistant owns the action: (Assistant)-[:HAS_ACTION]->(AssistantAction)
      relationship: "HAS_ACTION",
      cardinality: "one",
      required: true,
      dtoKey: "assistant",
      immutable: true,
    },
    message: {
      model: assistantMessageMeta,
      direction: "in", // (AssistantMessage)-[:REQUESTED_IN]->(AssistantAction)
      relationship: "REQUESTED_IN",
      cardinality: "one",
      required: false,
      dtoKey: "message",
      immutable: true,
    },
  },
});

export type AssistantActionDescriptorType = typeof AssistantActionDescriptor;
