import { Injectable, Logger } from "@nestjs/common";
import { GraphCatalogService } from "../services/graph.catalog.service";
import { EntityServiceRegistry } from "../../../common/registries/entity.service.registry";
import { CatalogEntity } from "../interfaces/graph.catalog.interface";

export interface UserContext {
  companyId: string;
  userId: string;
  userModules: string[];
}

export interface ToolCallRecord {
  tool: string;
  input: Record<string, unknown>;
  durationMs: number;
  error?: string;
}

@Injectable()
export class ToolFactory {
  private readonly logger = new Logger(ToolFactory.name);

  constructor(
    private readonly catalog: GraphCatalogService,
    private readonly registry: EntityServiceRegistry,
  ) {}

  resolveEntity(type: string, ctx: UserContext): CatalogEntity | { error: string } {
    const detail = this.catalog.getEntityDetail(type, ctx.userModules);
    if (!detail) return { error: `Entity type "${type}" is not available.` };
    return detail;
  }

  resolveService(type: string) {
    return this.registry.get(type);
  }

  capture<T>(
    record: { tool: string; input: Record<string, unknown> },
    fn: () => Promise<T>,
    recorder: ToolCallRecord[],
  ): Promise<T> {
    const start = Date.now();
    this.logger.log(`tool-call START: ${record.tool} input=${JSON.stringify(record.input)}`);
    return fn().then(
      (result) => {
        const durationMs = Date.now() - start;
        const resultError =
          result && typeof result === "object" && "error" in (result as any)
            ? String((result as any).error)
            : undefined;
        recorder.push({
          tool: record.tool,
          input: record.input,
          durationMs,
          ...(resultError ? { error: resultError } : {}),
        });
        const hint =
          result && typeof result === "object" && "items" in (result as any) && Array.isArray((result as any).items)
            ? `items=${(result as any).items.length}`
            : resultError
              ? `error=${resultError}`
              : "ok";
        this.logger.log(`tool-call END: ${record.tool} in ${durationMs}ms ${hint}`);
        return result;
      },
      (err) => {
        const durationMs = Date.now() - start;
        recorder.push({
          tool: record.tool,
          input: record.input,
          durationMs,
          error: err.message,
        });
        this.logger.warn(`tool-call FAILED: ${record.tool} in ${durationMs}ms message=${err.message}`);
        throw err;
      },
    );
  }
}
