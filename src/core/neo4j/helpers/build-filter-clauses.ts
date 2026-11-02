import { FilterCriterion, FilterOperator } from "../types/filter.criterion";

const VALID_IDENTIFIER = /^[A-Za-z_][A-Za-z0-9_]*$/;

const COMPARISON_OP: Partial<Record<FilterOperator, string>> = {
  eq: "=",
  ne: "<>",
  gt: ">",
  gte: ">=",
  lt: "<",
  lte: "<=",
};

/**
 * Base fields every node carries as a native Neo4j datetime. A comparison against one of
 * them casts the bound ISO string with `datetime($param)`; comparing a datetime property
 * with a plain string never matches.
 */
const DATETIME_BASE_FIELDS = new Set<string>(["updatedAt"]);

export interface BuildFilterClausesResult {
  clause: string;
  params: Record<string, unknown>;
}

export function buildFilterClauses(input: {
  nodeAlias: string;
  filters: FilterCriterion[];
  paramPrefix: string;
}): BuildFilterClausesResult {
  if (!VALID_IDENTIFIER.test(input.nodeAlias)) {
    throw new Error(`Invalid nodeAlias identifier: ${input.nodeAlias}`);
  }
  if (!VALID_IDENTIFIER.test(input.paramPrefix)) {
    throw new Error(`Invalid paramPrefix: ${input.paramPrefix}`);
  }

  const fragments: string[] = [];
  const params: Record<string, unknown> = {};

  input.filters.forEach((criterion, index) => {
    if (!VALID_IDENTIFIER.test(criterion.field)) {
      throw new Error(`Invalid field identifier: ${criterion.field}`);
    }
    const paramKey = `${input.paramPrefix}_${index}`;
    const lhs = `${input.nodeAlias}.${criterion.field}`;

    switch (criterion.op) {
      case "eq":
      case "ne":
      case "gt":
      case "gte":
      case "lt":
      case "lte": {
        const rhs = DATETIME_BASE_FIELDS.has(criterion.field) ? `datetime($${paramKey})` : `$${paramKey}`;
        fragments.push(`${lhs} ${COMPARISON_OP[criterion.op]} ${rhs}`);
        params[paramKey] = criterion.value;
        break;
      }
      case "in": {
        fragments.push(`${lhs} IN $${paramKey}`);
        params[paramKey] = criterion.value;
        break;
      }
      case "like": {
        fragments.push(`toLower(${lhs}) CONTAINS toLower($${paramKey})`);
        params[paramKey] = criterion.value;
        break;
      }
      case "isNull": {
        fragments.push(`${lhs} IS NULL`);
        break;
      }
      case "isNotNull": {
        fragments.push(`${lhs} IS NOT NULL`);
        break;
      }
      default: {
        throw new Error(`Unsupported operator: ${String((criterion as FilterCriterion).op)}`);
      }
    }
  });

  if (!fragments.length) return { clause: "", params };
  return {
    clause: fragments.join(" AND "),
    params,
  };
}
