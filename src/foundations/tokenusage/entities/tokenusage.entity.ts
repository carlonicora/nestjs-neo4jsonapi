import { Entity } from "../../../common/abstracts/entity";
import { Company } from "../../company/entities/company";

export type TokenUsage = Entity & {
  inputTokens: number;
  outputTokens: number;
  cost?: number;
  tokenUsageType: string;

  company: Company;
};
