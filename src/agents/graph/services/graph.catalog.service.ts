import { Injectable, Logger, OnApplicationBootstrap } from "@nestjs/common";
import { CatalogEntity, CatalogField, CatalogRelationship } from "../interfaces/graph.catalog.interface";
import { FieldKind } from "../../../common/interfaces/entity.schema.interface";

const FILTERABLE_TYPES = new Set(["string", "number", "boolean", "date", "datetime"]);
const SORTABLE_TYPES = new Set(["string", "number", "date", "datetime"]);

function renderFieldKindMarker(kind: FieldKind | undefined): string {
  if (!kind) return "";
  if (kind.type === "money") {
    const minor = kind.minorUnits ?? 2;
    const factor = minor === 0 ? "1" : `10^${minor}`;
    return `, money [integer stored in minor units (${minor} decimals); divide by ${factor} to display]`;
  }
  return "";
}

/**
 * Provided by the library bootstrap layer. Must return the full list of registered
 * entity descriptors (including their `moduleId` — the stable UUID of the `(Module)`
 * node in Neo4j, supplied by the feature module at `graphRegistry.register()` time).
 */
export interface DescriptorSource {
  loadAll(): Array<{
    model: { type: string; nodeName: string; labelName: string };
    description?: string;
    moduleId: string;
    fields: Record<string, { type: string; description?: string; kind?: FieldKind }>;
    relationships: Record<
      string,
      {
        model: { type: string; nodeName: string; labelName: string };
        direction: "in" | "out";
        relationship: string;
        cardinality: "one" | "many";
        description?: string;
        reverse?: { name: string; description: string };
      }
    >;
    chat?: { summary?: (d: any) => string; textSearchFields?: string[] };
  }>;
}

@Injectable()
export class GraphCatalogService implements OnApplicationBootstrap {
  private readonly logger = new Logger(GraphCatalogService.name);
  private entities = new Map<string, CatalogEntity>();
  /** Keyed by `moduleId` (UUID), value is the pre-rendered text fragment. */
  private renderedByModuleId = new Map<string, string>();

  constructor(private readonly source: DescriptorSource) {}

  onApplicationBootstrap() {
    this.buildCatalog();
  }

  buildCatalog(): void {
    this.entities.clear();
    this.renderedByModuleId.clear();

    const descriptors = this.source.loadAll().filter((d) => typeof d.description === "string" && d.description.length);

    // Pass 1: create CatalogEntity for every described descriptor (fields + forward relationships).
    for (const d of descriptors) {
      const fields: CatalogField[] = Object.entries(d.fields)
        .filter(([, def]) => typeof def.description === "string" && def.description.length)
        .map(([name, def]) => ({
          name,
          type: def.type,
          description: def.description!,
          filterable: FILTERABLE_TYPES.has(def.type),
          sortable: SORTABLE_TYPES.has(def.type),
          ...(def.kind ? { kind: def.kind } : {}),
        }));

      const relationships: CatalogRelationship[] = [];
      for (const [name, rel] of Object.entries(d.relationships)) {
        if (!rel.description) continue;
        relationships.push({
          name,
          sourceType: d.model.type,
          targetType: rel.model.type,
          cardinality: rel.cardinality,
          description: rel.description,
          cypherDirection: rel.direction,
          cypherLabel: rel.relationship,
          isReverse: false,
        });
      }

      this.entities.set(d.model.type, {
        type: d.model.type,
        moduleId: d.moduleId,
        description: d.description!,
        fields,
        relationships,
        summary: d.chat?.summary,
        textSearchFields: d.chat?.textSearchFields,
        nodeName: d.model.nodeName,
        labelName: d.model.labelName,
      });
    }

    // Pass 2: materialise reverse relationships on target entities.
    for (const d of descriptors) {
      for (const [name, rel] of Object.entries(d.relationships)) {
        if (!rel.description || !rel.reverse) continue;
        const target = this.entities.get(rel.model.type);
        if (!target) {
          this.logger.warn(`Reverse relationship "${rel.reverse.name}" dropped: target ${rel.model.type} not visible.`);
          continue;
        }
        const collision = target.relationships.find((r) => r.name === rel.reverse!.name);
        if (collision) {
          throw new Error(
            `Conflicting reverse relationship name "${rel.reverse.name}" on ${rel.model.type}: ` +
              `already defined by ${collision.sourceType}.${collision.name}`,
          );
        }
        target.relationships.push({
          name: rel.reverse.name,
          sourceType: rel.model.type,
          targetType: d.model.type,
          cardinality: rel.cardinality,
          description: rel.reverse.description,
          cypherDirection: rel.direction === "out" ? "in" : "out",
          cypherLabel: rel.relationship,
          isReverse: true,
          inverseKey: name,
        });
      }
    }

    // Pass 3: render per-moduleId text fragments.
    const byModuleId = new Map<string, CatalogEntity[]>();
    for (const e of this.entities.values()) {
      const list = byModuleId.get(e.moduleId) ?? [];
      list.push(e);
      byModuleId.set(e.moduleId, list);
    }
    for (const [moduleId, list] of byModuleId.entries()) {
      this.renderedByModuleId.set(moduleId, this.renderModule(moduleId, list));
    }
    this.logger.log(
      `Graph catalog built: ${this.entities.size} entities, ${byModuleId.size} modules: ${JSON.stringify(Array.from(this.entities.values()).map((e) => ({ type: e.type, moduleId: e.moduleId })))}`,
    );
  }

  private renderModule(moduleId: string, list: CatalogEntity[]): string {
    const entityBlocks = list.map((e) => {
      const fieldLines = e.fields.length
        ? e.fields
            .map((f) => {
              const kindMarker = renderFieldKindMarker(f.kind);
              return `    - ${f.name} (${f.type}${kindMarker}${f.sortable ? ", sortable" : ""}${f.filterable ? ", filterable" : ""})`;
            })
            .join("\n")
        : "    (no described fields)";
      return `- **${e.type}** — ${e.description}\n  fields:\n${fieldLines}`;
    });
    const relLines: string[] = [];
    for (const e of list) {
      for (const r of e.relationships) {
        if (r.isReverse) continue; // forward-only in the rendered map; reverse names appear in the bracket pair
        const forwardName = r.name;
        const reverse = this.entities
          .get(r.targetType)
          ?.relationships.find((x) => x.isReverse && x.sourceType === r.targetType && x.cypherLabel === r.cypherLabel);
        const names = reverse
          ? `${e.type}.${forwardName} / ${r.targetType}.${reverse.name}`
          : `${e.type}.${forwardName}`;
        relLines.push(`(${e.type}) --> (${r.targetType})  [${names}]  — ${r.description}`);
      }
    }
    return [
      `## Entities (module=${moduleId})`,
      entityBlocks.join("\n"),
      "",
      `## Relationships (module=${moduleId})`,
      relLines.join("\n"),
    ].join("\n");
  }

  getMapFor(userModuleIds: string[]): string {
    if (!userModuleIds.length) {
      this.logger.warn(`getMapFor: empty userModuleIds`);
      return "";
    }
    const accessible = new Set(userModuleIds);
    const registeredModuleIds = new Set(Array.from(this.entities.values()).map((e) => e.moduleId));
    const matchedModuleIds = userModuleIds.filter((m) => this.renderedByModuleId.has(m));
    const unmatchedUserModuleIds = userModuleIds.filter((m) => !this.renderedByModuleId.has(m));
    this.logger.log(
      `getMapFor: userModuleIds=${JSON.stringify(userModuleIds)} registeredModuleIds=${JSON.stringify(Array.from(registeredModuleIds))} matched=${JSON.stringify(matchedModuleIds)} unmatched=${JSON.stringify(unmatchedUserModuleIds)}`,
    );
    const sections: string[] = [];
    for (const m of userModuleIds) {
      const fragment = this.renderedByModuleId.get(m);
      if (!fragment) continue;
      sections.push(this.filterCrossModule(fragment, accessible));
    }
    return sections.join("\n\n");
  }

  private filterCrossModule(fragment: string, accessibleModuleIds: Set<string>): string {
    // Relationship lines: "(srcType) --> (targetType)  [..]". Drop if targetType's moduleId is inaccessible.
    const lines = fragment.split("\n");
    const out: string[] = [];
    for (const line of lines) {
      const match = line.match(/^\(\w+\)\s+-->\s+\((\w+)\)/);
      if (!match) {
        out.push(line);
        continue;
      }
      const targetType = match[1];
      const target = this.entities.get(targetType);
      if (target && accessibleModuleIds.has(target.moduleId)) out.push(line);
    }
    return out.join("\n");
  }

  /**
   * Returns a flat type index for the given user modules: one line per accessible
   * entity, in the form `- <type> — <description>`. No fields, no relationships.
   *
   * Used as the lightweight planner catalog and as the slim graph-node prompt body
   * (the LLM fetches per-type schema on demand via `describe_entity`).
   */
  getTypeIndexFor(userModuleIds: string[]): string {
    if (!userModuleIds.length) return "";
    const accessible = new Set(userModuleIds);
    const lines: string[] = [];
    for (const e of this.entities.values()) {
      if (!accessible.has(e.moduleId)) continue;
      lines.push(`- ${e.type} — ${e.description}`);
    }
    return lines.join("\n");
  }

  getAllChatEnabledEntities(): CatalogEntity[] {
    const out: CatalogEntity[] = [];
    for (const e of this.entities.values()) {
      if (e.textSearchFields?.length) out.push(e);
    }
    return out;
  }

  hasType(type: string): boolean {
    return this.entities.has(type);
  }

  getEntityDetail(type: string, userModuleIds: string[]): CatalogEntity | null {
    const e = this.entities.get(type);
    if (!e) return null;
    if (!userModuleIds.includes(e.moduleId)) return null;
    return e;
  }
}
