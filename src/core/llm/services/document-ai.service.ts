import { Injectable, Logger } from "@nestjs/common";
import { ZodType } from "zod";
import { ConfigService } from "@nestjs/config";
import { BaseConfigInterface, ConfigAiInterface } from "../../../config/interfaces";
import { convertZodToJsonSchema } from "../utils/schema.utils";

/**
 * Calls Mistral Document AI (OCR) on Azure AI Foundry.
 *
 * NOTE: this does NOT use the @mistralai/mistralai SDK — that SDK hardcodes Mistral's cloud
 * route (`<serverURL>/v1/ocr`) and cannot target the Azure Foundry route
 * (`<endpoint>/providers/mistral/azure/ocr`). We POST directly with Bearer auth instead.
 * The wire format is snake_case (image_url, document_annotation_format → json_schema.schema,
 * response document_annotation), built from the caller's Zod schema via convertZodToJsonSchema.
 *
 * `documentType` is returned as the raw extracted string; callers cast it to their own
 * domain enum (the service stays domain-agnostic).
 */
@Injectable()
export class DocumentAiService {
  private readonly logger = new Logger(DocumentAiService.name);
  private readonly CALL_TIMEOUT_MS = 120000;

  constructor(private readonly config: ConfigService<BaseConfigInterface>) {}

  async extract(params: { imageDataUrl: string; outputSchema: ZodType<any> }): Promise<{
    documentType: string | null;
    fields: Record<string, any>;
    confidence: number;
    tokenUsage: { input: number; output: number };
    ocrText: string;
  }> {
    const cfg = this.config.get<ConfigAiInterface>("ai").documentAi;
    // Accept either the resource base host or the full OCR URL in DOCUMENT_AI_URL.
    const raw = (cfg.url || "").replace(/\/+$/, "");
    const path = raw.endsWith("/ocr") ? raw : `${raw}/providers/mistral/azure/ocr`;
    const endpoint = cfg.apiVersion ? `${path}?api-version=${cfg.apiVersion}` : path;

    const body = {
      model: cfg.model,
      document: { type: "image_url", image_url: params.imageDataUrl },
      document_annotation_format: {
        type: "json_schema",
        json_schema: {
          name: "id_document_extraction",
          schema: convertZodToJsonSchema(params.outputSchema),
          strict: false,
        },
      },
    };

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.CALL_TIMEOUT_MS);
    let response: Response;
    try {
      response = await fetch(endpoint, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${cfg.apiKey}`,
        },
        body: JSON.stringify(body),
        signal: controller.signal,
      });
    } finally {
      clearTimeout(timer);
    }

    if (!response.ok) {
      const text = await response.text().catch(() => "");
      throw new Error(`Document AI OCR failed: ${response.status} ${text}`);
    }

    const json: any = await response.json();
    const annotation = json?.document_annotation ?? json?.documentAnnotation;
    if (!annotation || typeof annotation !== "string") {
      throw new Error("Document AI returned no document_annotation");
    }
    const parsed = JSON.parse(annotation);

    const ocrText = Array.isArray(json?.pages)
      ? json.pages
          .map((p: any) => p?.markdown ?? "")
          .join("\n\n")
          .trim()
      : "";

    return {
      documentType: (parsed.documentType ?? null) as string | null,
      fields: parsed.fields ?? {},
      confidence: typeof parsed.confidence === "number" ? parsed.confidence : 90,
      tokenUsage: { input: 0, output: 0 }, // OCR is billed per page, not tokens
      ocrText,
    };
  }
}
