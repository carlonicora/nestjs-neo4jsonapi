import { describe, it, expect } from "vitest";
import { makeTemplateData } from "./fixtures";
import { generateServiceFile } from "../templates/service.template";
import { generateModuleFile } from "../templates/module.template";

describe("backend service template", () => {
  it("injects AuditService into the constructor and super()", () => {
    const out = generateServiceFile(makeTemplateData());
    expect(out).toContain("AuditService");
    expect(out).toContain("auditService: AuditService");
    expect(out).toMatch(/super\(jsonApiService, widgetRepository, clsService, WidgetDescriptor\.model, auditService\)/);
  });
});

describe("backend module template", () => {
  it("registers with GraphModule and ModuleId", () => {
    const out = generateModuleFile(makeTemplateData());
    expect(out).toContain("GraphModule");
    expect(out).toContain("GraphDescriptorRegistry");
    expect(out).toContain('import { ModuleId } from "@neural-erp/shared"');
    expect(out).toContain("this.graphRegistry.register({");
    expect(out).toContain("moduleId: ModuleId.Widget");
    expect(out).toContain("imports: [AuditModule, GraphModule]");
  });

  it("exports the service by default and respects exportService:false", () => {
    expect(generateModuleFile(makeTemplateData())).toContain("exports: [WidgetService]");
    expect(generateModuleFile(makeTemplateData({ exportService: false }))).toContain("exports: []");
  });

  it("adds S3Module only when requiresS3", () => {
    expect(generateModuleFile(makeTemplateData({ requiresS3: true }))).toContain("S3Module");
  });
});
