import { Logger } from "@nestjs/common";
import { CatalogEntity } from "../interfaces/graph.catalog.interface";
import { GraphCatalogService } from "./graph.catalog.service";
import { EntityServiceRegistry } from "../../../common/registries/entity.service.registry";
import { UserContext } from "../tools/tool.factory";
import { buildToolFieldsOutput } from "./field-formatting";

const logger = new Logger("materialiseBridge");

/** Hard cap per cardinality-many materialised relationship. */
export const MATERIALISE_LIMIT = 50;

export interface BridgeRecordIn {
  id: string;
  /** Already type-converted target-node fields, as returned by buildToolFieldsOutput. */
  fields: Record<string, unknown>;
}

export interface BridgeRecordOut {
  id: string;
  type: string;
  summary: string;
  fields: Record<string, unknown>;
  __materialised: string[];
  __truncated?: Record<string, { returned: number; hasMore: true }>;
  // plus one key per materialised relationship: T or T[]
  [key: string]: unknown;
}

export interface MaterialiseBridgeDeps {
  catalog: GraphCatalogService;
  registry: EntityServiceRegistry;
}

export async function materialiseBridge(params: {
  bridge: CatalogEntity;
  record: BridgeRecordIn;
  ctx: UserContext;
  deps: MaterialiseBridgeDeps;
  /** Counter used by the responder to populate trace.materialisedBridges. Optional. */
  onMaterialised?: (relName: string, count: number) => void;
}): Promise<BridgeRecordOut> {
  const { bridge, record, ctx, deps } = params;
  if (!bridge.bridge) {
    throw new Error(`materialiseBridge called on non-bridge entity "${bridge.type}".`);
  }

  const summary = bridge.summary ? bridge.summary({ id: record.id, ...record.fields }) : record.id;
  const out: BridgeRecordOut = {
    id: record.id,
    type: bridge.type,
    summary: String(summary),
    fields: record.fields,
    __materialised: [],
  };

  for (const relName of bridge.bridge.materialiseTo) {
    const rel = bridge.relationships.find((r) => r.name === relName);
    if (!rel) {
      // Should be impossible — defineEntity / catalog buildCatalog enforce this — but
      // be defensive at runtime so a stale catalog doesn't crash a tool call.
      logger.warn(`materialiseBridge: relationship "${relName}" not found on ${bridge.type}; skipping.`);
      continue;
    }

    // Module-gated drop: target type the user can't access disappears from the response.
    const target = deps.catalog.getEntityDetail(rel.targetType, ctx.userModuleIds);
    if (!target) {
      logger.debug(
        `materialiseBridge: target type ${rel.targetType} not accessible to user; dropping ${bridge.type}.${relName}`,
      );
      continue;
    }

    const targetSvc = deps.registry.get(target.type);
    if (!targetSvc) {
      logger.warn(`materialiseBridge: no service registered for ${target.type}; dropping ${bridge.type}.${relName}`);
      continue;
    }

    const targetDirection: "in" | "out" = rel.cypherDirection === "out" ? "in" : "out";
    const records: any[] = await targetSvc.findRelatedRecordsByEdge({
      cypherLabel: rel.cypherLabel,
      cypherDirection: targetDirection,
      relatedLabel: bridge.labelName,
      relatedId: record.id,
      limit: MATERIALISE_LIMIT + 1, // overfetch by one to detect truncation cheaply
    });

    const truncated = records.length > MATERIALISE_LIMIT;
    const visible = records.slice(0, MATERIALISE_LIMIT);
    const summariser = target.summary ?? ((d: any) => String(d.name ?? d.id));
    const materialised = visible.map((r) => ({
      id: r.id,
      type: target.type,
      summary: String(summariser(r)),
      fields: buildToolFieldsOutput(target.fields, r),
    }));

    out[relName] = rel.cardinality === "one" ? (materialised[0] ?? null) : materialised;
    out.__materialised.push(relName);

    if (truncated) {
      out.__truncated = out.__truncated ?? {};
      out.__truncated[relName] = { returned: MATERIALISE_LIMIT, hasMore: true };
    }

    params.onMaterialised?.(relName, materialised.length);
  }

  return out;
}
