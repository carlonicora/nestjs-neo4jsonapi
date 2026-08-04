import { Entity, defineEntity } from "../../../common";
import { companyMeta } from "../../company/entities/company.meta";
import { roleMeta } from "../../role/entities/role.meta";
import { userMeta } from "../../user/entities/user.meta";
import { membershipMeta } from "./membership.meta";

/**
 * Membership: the per-company container for a user's roles.
 * (user)-[:HAS_MEMBERSHIP]->(membership)-[:IN_COMPANY]->(company)
 * (membership)-[:HAS_ROLE]->(role)
 * A membership with NO IN_COMPANY edge is a platform-level membership
 * (global Administrator). Backend-internal: no controller, no endpoint.
 */
export type Membership = Entity;

export const MembershipDescriptor = defineEntity<Membership>()({
  ...membershipMeta,

  // Platform-level memberships have NO IN_COMPANY edge (global Administrator).
  // A company-scoped default would BELONGS_TO-filter any future generic read
  // and silently hide platform memberships.
  isCompanyScoped: false,

  fields: {},

  relationships: {
    user: { model: userMeta, direction: "in", relationship: "HAS_MEMBERSHIP", cardinality: "one", dtoKey: "user" },
    company: {
      model: companyMeta,
      direction: "out",
      relationship: "IN_COMPANY",
      cardinality: "one",
      dtoKey: "company",
    },
    role: { model: roleMeta, direction: "out", relationship: "HAS_ROLE", cardinality: "many", dtoKey: "roles" },
  },
});

export type MembershipDescriptorType = typeof MembershipDescriptor;
