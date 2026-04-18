import { Injectable } from "@nestjs/common";
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
    return fn().then(
      (result) => {
        recorder.push({ tool: record.tool, input: record.input, durationMs: Date.now() - start });
        return result;
      },
      (err) => {
        recorder.push({
          tool: record.tool,
          input: record.input,
          durationMs: Date.now() - start,
          error: err.message,
        });
        throw err;
      },
    );
  }
}
