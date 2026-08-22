import { Injectable } from "@nestjs/common";
import { readFileSync } from "fs";
import * as yaml from "js-yaml";
import { EvalQuestionSet, evalQuestionSetSchema } from "./retrieval-eval.types";

/**
 * Reads a question set from YAML and validates it.
 *
 * Fails loudly and specifically: a malformed ground truth that loads anyway
 * would silently weaken every later comparison, which is the opposite of what
 * this harness exists for.
 *
 * Mirrors the YAML-loading style of `core/model-manager/model-loader.ts`.
 */
@Injectable()
export class QuestionSetLoader {
  load(params: { path: string }): EvalQuestionSet {
    const raw = yaml.load(readFileSync(params.path, "utf8"));
    const parsed = evalQuestionSetSchema.safeParse(raw);
    if (!parsed.success) {
      const issues = parsed.error.issues
        .map((issue) => `${issue.path.join(".") || "<root>"}: ${issue.message}`)
        .join("; ");
      throw new Error(`Invalid question set at ${params.path} — ${issues}`);
    }
    return parsed.data;
  }
}
