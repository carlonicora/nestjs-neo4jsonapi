import { TemplateData } from "../types/template-data.interface";

export function makeTemplateData(overrides: Partial<TemplateData> = {}): TemplateData {
  return {
    names: { pascalCase: "Widget", camelCase: "widget", kebabCase: "widget", pluralKebab: "widgets" },
    endpoint: "widgets",
    labelName: "Widget",
    nodeName: "widget",
    isCompanyScoped: true,
    targetDir: "features/demo",
    sharedScope: "@test/shared",
    fields: [
      { name: "name", type: "string", required: true, tsType: "string" },
      { name: "due_date", type: "date", required: false, tsType: "string" },
    ],
    relationships: [],
    aliasMetas: [],
    libraryImports: [],
    entityImports: [],
    metaImports: [],
    dtoImports: [],
    nestedRoutes: [],
    dtoFields: [],
    postDtoRelationships: [],
    putDtoRelationships: [],
    requiresS3: false,
    exportService: true,
    ...overrides,
  };
}
