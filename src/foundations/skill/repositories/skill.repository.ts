import { Injectable } from "@nestjs/common";
import { ClsService } from "nestjs-cls";
import { JsonApiCursorInterface } from "../../../core/jsonapi/interfaces/jsonapi.cursor.interface";
import { AbstractRepository } from "../../../core/neo4j/abstracts/abstract.repository";
import { buildFulltextTerm } from "../../../core/neo4j/helpers/build-fulltext-term";
import { buildListOrderByClause, codeOrderBy } from "../../../core/neo4j/helpers/build-order-by";
import { Neo4jService } from "../../../core/neo4j/services/neo4j.service";
import { SortCriterion } from "../../../core/neo4j/types/filter.criterion";
import { SecurityService } from "../../../core/security/services/security.service";
import { companyMeta } from "../../company/entities/company.meta";
import { Skill, SkillDescriptor } from "../entities/skill";
import { skillMeta } from "../entities/skill.meta";

const N = skillMeta.nodeName;
const L = skillMeta.labelName;
const COMPANY = companyMeta.labelName;

/** The skill belongs to the company in context. */
const OWNED = `EXISTS { (${N})-[:BELONGS_TO]->(:${COMPANY} { id: $companyId }) }`;

/** One of the company's skills is a copy of this (global) skill. */
const COPIED_BY_COMPANY = `EXISTS { MATCH (copyOf:${L})-[:OVERRIDES]->(${N}) WHERE EXISTS { (copyOf)-[:BELONGS_TO]->(:${COMPANY} { id: $companyId }) } }`;

/** The company owns a skill with this skill's name that is not a copy of it. */
const HIDDEN_BY_COMPANY = `EXISTS { MATCH (sameName:${L})-[:BELONGS_TO]->(:${COMPANY} { id: $companyId }) WHERE sameName.name = ${N}.name AND NOT EXISTS { (sameName)-[:OVERRIDES]->(${N}) } }`;

/** The company switched this global skill off for itself. */
const DISABLED_BY_COMPANY = `EXISTS { (:${COMPANY} { id: $companyId })-[:DISABLED_SKILL]->(${N}) }`;

/**
 * Active for the company: its own skills and copies that are on; globals that are on,
 * not switched off by the company, not copied by it and not hidden by a same-named skill of it.
 */
const ACTIVE_FOR_COMPANY = `(
  (${OWNED} AND ${N}.isActive = true)
  OR (
    ${N}.isGlobal = true AND ${N}.isActive = true
    AND NOT ${DISABLED_BY_COMPANY}
    AND NOT ${COPIED_BY_COMPANY}
    AND NOT EXISTS { MATCH (sameName:${L})-[:BELONGS_TO]->(:${COMPANY} { id: $companyId }) WHERE sameName.name = ${N}.name }
  )
)`;

@Injectable()
export class SkillRepository extends AbstractRepository<Skill, typeof SkillDescriptor.relationships> {
  protected readonly descriptor = SkillDescriptor;

  constructor(neo4j: Neo4jService, securityService: SecurityService, clsService: ClsService) {
    super(neo4j, securityService, clsService);
  }

  /**
   * A skill is readable when it is a global skill that is on, or when it belongs to the
   * caller's company (decision P1, as CalendarRepository). With no company in context the
   * EXISTS matches nothing, so only active globals are read; the base class's forbidden
   * re-check therefore answers 404 for another company's skill or a globally switched-off one.
   *
   * It does NOT call super: the descriptor's tenancy would emit a company-only predicate,
   * which would drop the global skills.
   */
  protected buildDefaultMatch(options?: { searchField?: string; blockCompanyAndUser?: boolean }): string {
    return `
      MATCH (${N}:${L}${options?.searchField ? ` {${options.searchField}: $searchValue}` : ``})
      WHERE (${N}.isGlobal = true AND ${N}.isActive = true)
        OR ${OWNED}
      WITH ${N}
    `;
  }

  /**
   * The inherited relationship columns plus the four per-caller states of the company in
   * context: skillOrigin, skillIsEnabled, skillIsHidden, skillCanRestore.
   */
  protected buildReturnStatement(): string {
    return this.withColumns(`
      WITH ${N},
        CASE
          WHEN ${N}.isGlobal = true THEN "global"
          WHEN EXISTS { (${N})-[:OVERRIDES]->(:${L}) } THEN "copy"
          ELSE "company"
        END AS skillOrigin,
        CASE
          WHEN ${N}.isGlobal = true THEN coalesce(${N}.isActive, false) AND NOT ${DISABLED_BY_COMPANY}
          ELSE coalesce(${N}.isActive, false)
        END AS skillIsEnabled,
        (${N}.isGlobal = true AND ${HIDDEN_BY_COMPANY}) AS skillIsHidden,
        EXISTS { MATCH (${N})-[:OVERRIDES]->(restored:${L}) WHERE restored.isActive = true } AS skillCanRestore
    `);
  }

  /** Administrator view of a global skill: states that do not depend on any company. */
  private buildGlobalReturnStatement(): string {
    return this.withColumns(`
      WITH ${N},
        "global" AS skillOrigin,
        coalesce(${N}.isActive, false) AS skillIsEnabled,
        false AS skillIsHidden,
        false AS skillCanRestore
    `);
  }

  private withColumns(columns: string): string {
    return `
      ${columns}
      ${super.buildReturnStatement()}, skillOrigin, skillIsEnabled, skillIsHidden, skillCanRestore
    `;
  }

  /** One skill the caller can see, or null (never a 403). */
  async findScopedById(params: { id: string }): Promise<Skill | null> {
    const query = this.neo4j.initQuery({ serialiser: SkillDescriptor.model });
    query.queryParams = { ...query.queryParams, searchValue: params.id };
    query.query += `
      ${this.buildDefaultMatch({ searchField: "id" })}
      ${this.buildReturnStatement()}
    `;
    return this.neo4j.readOne(query);
  }

  /** The company's list: its own skills, its copies, and the globals it has not copied. */
  async findForCompany(params: {
    cursor: JsonApiCursorInterface;
    term?: string;
    orderByFields?: SortCriterion[];
  }): Promise<Skill[]> {
    const query = this.neo4j.initQuery({ serialiser: SkillDescriptor.model, cursor: params.cursor });
    query.queryParams = { ...query.queryParams, term: buildFulltextTerm(params.term) };

    const notCopied = `NOT ${COPIED_BY_COMPANY}`;
    const orderBy = buildListOrderByClause({
      nodeAlias: N,
      sort: params.orderByFields,
      defaultOrderBy: codeOrderBy(`${N}.name ASC, ${N}.isGlobal ASC`),
      scoreVariable: params.term ? "score" : undefined,
    });

    if (params.term && this.descriptor.fulltextIndexName) {
      query.query += this.buildFulltextAccessCheckedMatch({ filterClause: notCopied, orderByClause: orderBy });
    } else {
      query.query += `
        ${this.buildDefaultMatch()}
        ${this.securityService.userHasAccess({ validator: () => this.buildUserHasAccess() })}
        WHERE ${notCopied}
        ${orderBy}
      `;
    }

    query.query += `
      {CURSOR}
      ${this.buildReturnStatement()}
    `;
    return this.neo4j.readMany(query);
  }

  /** Every skill active for the company in context (active globals only without one). */
  async findActiveForCompany(): Promise<Skill[]> {
    const query = this.neo4j.initQuery({ serialiser: SkillDescriptor.model, fetchAll: true });
    query.query += `
      ${this.buildDefaultMatch()}
      WHERE ${ACTIVE_FOR_COMPANY}
      ORDER BY ${N}.name ASC
      ${this.buildReturnStatement()}
    `;
    return this.neo4j.readMany(query);
  }

  /** The named skills that are active for the company in context. */
  async findActiveByNames(params: { names: string[] }): Promise<Skill[]> {
    const query = this.neo4j.initQuery({ serialiser: SkillDescriptor.model, fetchAll: true });
    query.queryParams = { ...query.queryParams, names: params.names };
    query.query += `
      ${this.buildDefaultMatch()}
      WHERE ${N}.name IN $names AND ${ACTIVE_FOR_COMPANY}
      ORDER BY ${N}.name ASC
      ${this.buildReturnStatement()}
    `;
    return this.neo4j.readMany(query);
  }

  /** Every global skill, on or off. Reached only from SkillAdminController (decision P2). */
  async findGlobal(params: {
    cursor: JsonApiCursorInterface;
    term?: string;
    orderByFields?: SortCriterion[];
  }): Promise<Skill[]> {
    const query = this.neo4j.initQuery({ serialiser: SkillDescriptor.model, cursor: params.cursor });
    query.queryParams = { ...query.queryParams, term: buildFulltextTerm(params.term) };

    const searching = !!(params.term && this.descriptor.fulltextIndexName);
    const orderBy = buildListOrderByClause({
      nodeAlias: N,
      sort: params.orderByFields,
      defaultOrderBy: codeOrderBy(`${N}.name ASC`),
      scoreVariable: searching ? "score" : undefined,
    });

    if (searching) {
      query.query += `
        CALL db.index.fulltext.queryNodes("${this.descriptor.fulltextIndexName}", $term)
        YIELD node, score
        WITH node AS ${N}, score
        WHERE ${N}:${L} AND ${N}.isGlobal = true
        ${orderBy}
      `;
    } else {
      query.query += `
        MATCH (${N}:${L})
        WHERE ${N}.isGlobal = true
        WITH ${N}
        ${orderBy}
      `;
    }

    query.query += `
      {CURSOR}
      ${this.buildGlobalReturnStatement()}
    `;
    return this.neo4j.readMany(query);
  }

  /** One global skill, on or off, or null. Reached only from SkillAdminController (decision P2). */
  async findGlobalById(params: { id: string }): Promise<Skill | null> {
    const query = this.neo4j.initQuery({ serialiser: SkillDescriptor.model });
    query.queryParams = { ...query.queryParams, searchValue: params.id };
    query.query += `
      MATCH (${N}:${L} {id: $searchValue})
      WHERE ${N}.isGlobal = true
      WITH ${N}
      ${this.buildGlobalReturnStatement()}
    `;
    return this.neo4j.readOne(query);
  }

  /**
   * One of the company's skills is a copy of this global skill, through the OVERRIDES edge.
   * Never by name: a copy keeps its old name when the Administrator renames the original.
   */
  async isCopiedByCompany(params: { id: string }): Promise<boolean> {
    const query = this.neo4j.initQuery({ serialiser: SkillDescriptor.model });
    query.queryParams = { ...query.queryParams, searchValue: params.id };
    query.query += `
      ${this.buildDefaultMatch({ searchField: "id" })}
      RETURN ${COPIED_BY_COMPANY} AS copied
    `;
    const rows = await this.neo4j.readScalars({
      query: query.query,
      queryParams: query.queryParams,
      map: (row) => row.copied === true,
    });
    return rows[0] ?? false;
  }

  /** How many skills the company in context owns, copies included, switched-off ones counted. */
  async countOwn(): Promise<number> {
    const query = this.neo4j.initQuery({ serialiser: SkillDescriptor.model });
    query.query += `
      ${this.buildDefaultMatch()}
      WHERE coalesce(${N}.isGlobal, false) = false
      RETURN count(${N}) AS total
    `;
    const rows = await this.neo4j.readScalars({
      query: query.query,
      queryParams: query.queryParams,
      map: (row) => Number(row.total ?? 0),
    });
    return rows[0] ?? 0;
  }

  /**
   * What blocks a company skill name: "own" when one of the company's skills (copies
   * included, excludeId aside) has it; otherwise "global" when an active global has it and
   * the company has not copied that global; otherwise null.
   */
  async findNameClash(params: { name: string; excludeId?: string }): Promise<"own" | "global" | null> {
    const query = this.neo4j.initQuery({ serialiser: SkillDescriptor.model });
    query.queryParams = { ...query.queryParams, name: params.name, excludeId: params.excludeId ?? null };
    query.query += `
      ${this.buildDefaultMatch()}
      WHERE ${N}.name = $name AND ($excludeId IS NULL OR ${N}.id <> $excludeId)
      RETURN CASE
        WHEN coalesce(${N}.isGlobal, false) = false THEN "own"
        WHEN NOT ${COPIED_BY_COMPANY} THEN "global"
        ELSE null
      END AS clash
    `;
    const clashes = await this.neo4j.readScalars({
      query: query.query,
      queryParams: query.queryParams,
      map: (row) => (row.clash === "own" || row.clash === "global" ? row.clash : null),
    });
    if (clashes.includes("own")) return "own";
    if (clashes.includes("global")) return "global";
    return null;
  }

  /** Whether another global skill already has the name. Administrator routes only. */
  async findGlobalNameClash(params: { name: string; excludeId?: string }): Promise<boolean> {
    const query = this.neo4j.initQuery({ serialiser: SkillDescriptor.model });
    query.queryParams = { ...query.queryParams, name: params.name, excludeId: params.excludeId ?? null };
    query.query += `
      MATCH (${N}:${L})
      WHERE ${N}.isGlobal = true AND ${N}.name = $name AND ($excludeId IS NULL OR ${N}.id <> $excludeId)
      RETURN count(${N}) AS total
    `;
    const rows = await this.neo4j.readScalars({
      query: query.query,
      queryParams: query.queryParams,
      map: (row) => Number(row.total ?? 0),
    });
    return (rows[0] ?? 0) > 0;
  }

  /** Switches a global skill off (disabled) or back on for the company in context. */
  async setDisabledForCompany(params: { id: string; disabled: boolean }): Promise<void> {
    await this.neo4j.validateRelatedNodes({ nodes: [{ id: params.id, label: skillMeta.labelName }] });

    // The edge starts at the "company" alias initQuery() binds for the company in context. No
    // WITH may come between the two, or the alias is dropped. Unbound, a MERGE on "company"
    // would create an orphan node, so refuse instead.
    if (this.neo4j.bindsRequestContext === false || !this.clsService.get("companyId")) {
      throw new Error("skills: switching a global skill for a company needs the request's company");
    }
    const query = this.neo4j.initQuery({ serialiser: SkillDescriptor.model });
    query.queryParams = { ...query.queryParams, id: params.id };
    query.query += `
      MATCH (${N}:${L} { id: $id })
      WHERE ${N}.isGlobal = true
      ${
        params.disabled
          ? `MERGE (company)-[:DISABLED_SKILL]->(${N})`
          : `OPTIONAL MATCH (company)-[disabledEdge:DISABLED_SKILL]->(${N})
             DELETE disabledEdge`
      }
    `;
    await this.neo4j.writeOne(query);
  }
}
