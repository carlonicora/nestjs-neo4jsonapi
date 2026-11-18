import { defineEntity, Entity } from "../../../common";
import { Company } from "../../company/entities/company";
import { companyMeta } from "../../company/entities/company.meta";
import { skillMeta } from "./skill.meta";

/** Where a skill in a company's list comes from. */
export type SkillOrigin = "global" | "copy" | "company";

/**
 * Skill Entity Type
 *
 * A named set of instructions the Assistant follows. A global skill (no company
 * edge, `isGlobal`) is shared by every company; a company skill BELONGS_TO one
 * company; a copy is a company skill that OVERRIDES a global one.
 */
export type Skill = Entity & {
  name: string;
  description: string;
  instructions: string;
  isActive: boolean;
  isGlobal: boolean;

  origin?: SkillOrigin;
  isEnabled?: boolean;
  isHidden?: boolean;
  canRestore?: boolean;

  company?: Company;
  original?: Skill;
};

/** Reads a per-caller column of SkillRepository.buildReturnStatement(), falling back to the data. */
const fromColumn =
  (column: string, field: string) =>
  (params: { data: any; record: any }): any => {
    if (params.record?.has?.(column)) return params.record.get(column);
    return params.data?.[field];
  };

/**
 * Skill Entity Descriptor
 *
 * Mixes platform rows (global skills, no company edge) with company-owned rows,
 * like Calendar (decision P1): `isCompanyScoped: false` with
 * `tenancy: { via: "company" }` and `linkScope: "own-or-platform"`, and
 * SkillRepository overrides buildDefaultMatch() to read "active global OR mine".
 *
 * No `description`: Skill stays out of the Assistant's graph catalog (as Race does).
 *
 * `origin`, `isEnabled`, `isHidden` and `canRestore` are per-caller states computed
 * in the query. They are listed in `fields` too because the serialiser emits
 * attributes from `fields` only; nothing stores them.
 */
export const SkillDescriptor = defineEntity<Skill>()({
  ...skillMeta,

  isCompanyScoped: false,
  tenancy: { via: "company" },
  linkScope: "own-or-platform",

  fields: {
    name: { type: "string", required: true, sortable: true },
    description: { type: "string", required: true },
    instructions: { type: "string", required: true, excludeFromSearch: true },
    isActive: { type: "boolean" },
    isGlobal: { type: "boolean", immutable: true },
    origin: { type: "string", excludeFromSearch: true },
    isEnabled: { type: "boolean" },
    isHidden: { type: "boolean" },
    canRestore: { type: "boolean" },
  },

  computed: {
    origin: { compute: fromColumn("skillOrigin", "origin") },
    isEnabled: { compute: fromColumn("skillIsEnabled", "isEnabled") },
    isHidden: { compute: fromColumn("skillIsHidden", "isHidden") },
    canRestore: { compute: fromColumn("skillCanRestore", "canRestore") },
  },

  relationships: {
    company: {
      model: companyMeta,
      direction: "out",
      relationship: "BELONGS_TO",
      cardinality: "one",
      // Absent on global skills: keeps the generic loop on OPTIONAL MATCH.
      required: false,
      // Set by SkillService from CLS on create (no contextKey: a global skill
      // created by an Administrator who belongs to a company must get no edge).
      immutable: true,
    },
    original: {
      model: skillMeta,
      direction: "out",
      relationship: "OVERRIDES",
      cardinality: "one",
      required: false,
      immutable: true,
      dtoKey: "original",
    },
  },
});

export type SkillDescriptorType = typeof SkillDescriptor;
