import { TemplateData } from "../types/template-data.interface";

/**
 * Generate meta file content
 *
 * Meta files contain lightweight metadata (type, endpoint, nodeName, labelName)
 * that can be imported without causing circular dependencies.
 *
 * @param data - Template data
 * @returns Generated TypeScript code for meta file
 */
export function generateMetaFile(data: TemplateData): string {
  const { names, endpoint, nodeName, labelName } = data;

  return `import { DataMeta } from "@carlonicora/nestjs-neo4jsonapi";

export const ${names.camelCase}Meta: DataMeta = {
  type: "${endpoint}",
  endpoint: "${endpoint}",
  nodeName: "${nodeName}",
  labelName: "${labelName}",
};
`;
}
