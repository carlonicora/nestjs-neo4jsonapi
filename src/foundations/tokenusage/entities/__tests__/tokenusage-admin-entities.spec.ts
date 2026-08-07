import { describe, expect, it } from "vitest";
import { TokenUsageAdminBreakdownDescriptor } from "../tokenusage-admin-breakdown";
import { TokenUsageAdminSummaryDescriptor } from "../tokenusage-admin-summary";
import { TokenUsageAdminTimelineDescriptor } from "../tokenusage-admin-timeline";

describe("token usage admin aggregate descriptors", () => {
  it("are not company scoped and declare no relationships", () => {
    for (const d of [
      TokenUsageAdminSummaryDescriptor,
      TokenUsageAdminTimelineDescriptor,
      TokenUsageAdminBreakdownDescriptor,
    ]) {
      expect(d.isCompanyScoped).toBe(false);
      expect(Object.keys(d.relationships)).toHaveLength(0);
    }
  });

  it("expose the shared metric field set on every resource", () => {
    for (const d of [
      TokenUsageAdminSummaryDescriptor,
      TokenUsageAdminTimelineDescriptor,
      TokenUsageAdminBreakdownDescriptor,
    ]) {
      for (const f of ["cost", "credits", "tokensIn", "tokensOut", "cached", "calls"]) {
        expect(d.fields[f as keyof typeof d.fields]).toEqual({ type: "number", required: true });
      }
    }
  });

  it("types the timeline bucket as a calendar date, never a string", () => {
    expect(TokenUsageAdminTimelineDescriptor.fields.bucket).toEqual({ type: "date", required: true });
  });

  it("uses distinct JSON:API types and endpoints", () => {
    expect(TokenUsageAdminSummaryDescriptor.model.type).toBe("tokenusage-admin-summaries");
    expect(TokenUsageAdminTimelineDescriptor.model.type).toBe("tokenusage-admin-timelines");
    expect(TokenUsageAdminBreakdownDescriptor.model.type).toBe("tokenusage-admin-breakdowns");
    expect(TokenUsageAdminSummaryDescriptor.model.endpoint).toBe("tokenusages/administration/summary");
  });
});
