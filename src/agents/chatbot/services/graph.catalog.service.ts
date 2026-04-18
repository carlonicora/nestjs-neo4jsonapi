import { Injectable, Logger, OnApplicationBootstrap } from "@nestjs/common";
import { CatalogEntity, CatalogField, CatalogRelationship } from "../interfaces/graph.catalog.interface";

const FILTERABLE_TYPES = new Set(["string", "number", "boolean", "date", "datetime"]);
const SORTABLE_TYPES = new Set(["string", "number", "date", "datetime"]);

/**
 * Provided by the library bootstrap layer. Must return the full list of registered
 * entity descriptors (including their `module` identifier, which is derived from the
 * feature-module registration path).
 */
export interface DescriptorSource {
  loadAll(): Array<{
    model: { type: string; nodeName: string; labelName: string };
    description?: string;
    module: string;
    fields: Record<string, { type: string; description?: string }>;
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
  private renderedByModule = new Map<string, string>();

  constructor(private readonly source: DescriptorSource) {}

  onApplicationBootstrap() {
    this.buildCatalog();
  }

  buildCatalog(): void {
    this.entities.clear();
    this.renderedByModule.clear();

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
        module: d.module,
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

    // Pass 3: render per-module text fragments.
    const byModule = new Map<string, CatalogEntity[]>();
    for (const e of this.entities.values()) {
      const list = byModule.get(e.module) ?? [];
      list.push(e);
      byModule.set(e.module, list);
    }
    for (const [module, list] of byModule.entries()) {
      this.renderedByModule.set(module, this.renderModule(module, list));
    }
    this.logger.log(
      `Graph catalog built: ${this.entities.size} entities, ${byModule.size} modules: ${JSON.stringify(Array.from(this.entities.values()).map((e) => ({ type: e.type, module: e.module })))}`,
    );
  }

  private renderModule(module: string, list: CatalogEntity[]): string {
    const entityLines = list.map((e) => `- ${e.type} — ${e.description}`).join("\n");
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
    return [`## Entities (${module})`, entityLines, "", `## Relationships (${module})`, relLines.join("\n")].join("\n");
  }

  getMapFor(userModules: string[]): string {
    if (!userModules.length) {
      this.logger.warn(`getMapFor: empty userModules`);
      return "";
    }
    const accessible = new Set(userModules);
    const registeredModules = new Set(Array.from(this.entities.values()).map((e) => e.module));
    const matchedModules = userModules.filter((m) => this.renderedByModule.has(m));
    const unmatchedUserModules = userModules.filter((m) => !this.renderedByModule.has(m));
    this.logger.log(
      `getMapFor: userModules=${JSON.stringify(userModules)} registeredModules=${JSON.stringify(Array.from(registeredModules))} matched=${JSON.stringify(matchedModules)} unmatched=${JSON.stringify(unmatchedUserModules)}`,
    );
    const sections: string[] = [];
    for (const m of userModules) {
      const fragment = this.renderedByModule.get(m);
      if (!fragment) continue;
      sections.push(this.filterCrossModule(fragment, accessible));
    }
    return sections.join("\n\n");
  }

  private filterCrossModule(fragment: string, accessible: Set<string>): string {
    // Relationship lines: "(srcType) --> (targetType)  [..]". Drop if targetType module inaccessible.
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
      if (target && accessible.has(target.module)) out.push(line);
    }
    return out.join("\n");
  }

  hasType(type: string): boolean {
    return this.entities.has(type);
  }

  getEntityDetail(type: string, userModules: string[]): CatalogEntity | null {
    const e = this.entities.get(type);
    if (!e) return null;
    if (!userModules.includes(e.module)) return null;
    return e;
  }
}
