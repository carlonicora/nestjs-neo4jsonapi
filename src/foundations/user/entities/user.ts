import {
  Entity,
  defineEntity,
  defineEntityAlias,
} from "../../../common";
import { S3Service } from "../../s3";
import type { Role } from "../../role/entities/role.entity";
import type { Company } from "../../company/entities/company";
import type { Module } from "../../module/entities/module.entity";
import { roleMeta } from "../../role/entities/role.meta";
import { CompanyDescriptor } from "../../company/entities/company";
import { moduleMeta } from "../../module/entities/module.meta";
import { userMeta, ownerMeta, assigneeMeta, authorMeta } from "./user.meta";

/**
 * User Entity Type
 */
export type User = Entity & {
  email: string;
  name?: string;
  title?: string;
  bio?: string;
  password?: string;
  avatar?: string;
  phone?: string;
  rate?: number;
  isActive: boolean;
  lastLogin?: Date;
  isDeleted: boolean;
  code?: string;
  codeExpiration?: Date;
  termsAcceptedAt?: Date;
  marketingConsent?: boolean;
  marketingConsentAt?: Date;

  role?: Role[];
  company?: Company;
  module?: Module[];
};


/**
 * User Entity Descriptor
 *
 * Single source of truth for the User entity configuration.
 * Generates mapper, childrenTokens, and DataModelInterface automatically.
 */
export const UserDescriptor = defineEntity<User>()({
  ...userMeta,

  injectServices: [S3Service],

  // Field definitions
  fields: {
    email: { type: "string", required: true },
    name: { type: "string" },
    title: { type: "string" },
    bio: { type: "string" },
    password: { type: "string" },
    avatar: {
      type: "string",
      transform: async (data, services) => {
        if (!data.avatar) return undefined;
        if (data.avatar.startsWith("~")) return data.avatar.substring(1);
        return await services.S3Service.generateSignedUrl({ key: data.avatar, isPublic: true });
      },
    },
    phone: { type: "string" },
    rate: { type: "number" },
    isActive: { type: "boolean", meta: true },
    lastLogin: { type: "datetime", meta: true },
    isDeleted: { type: "boolean", meta: true },
    code: { type: "string" },
    codeExpiration: { type: "datetime" },
    termsAcceptedAt: { type: "datetime" },
    marketingConsent: { type: "boolean" },
    marketingConsentAt: { type: "datetime" },
  },

  // Virtual fields (output-only, not in entity type)
  virtualFields: {
    avatarUrl: {
      compute: (params) => params.data.avatar,
    },
  },

  // Relationship definitions
  relationships: {
    role: {
      model: roleMeta,
      direction: "out",
      relationship: "MEMBER_OF",
      cardinality: "many",
      dtoKey: "roles",
    },
    company: {
      model: CompanyDescriptor.model,
      direction: "out",
      relationship: "BELONGS_TO",
      cardinality: "one",
    },
    module: {
      model: moduleMeta,
      direction: "out",
      relationship: "RELATED_TO",
      cardinality: "many",
      dtoKey: "modules",
    },
  },
});

// Type export for the descriptor
export type UserDescriptorType = typeof UserDescriptor;

// Alias descriptors for relationship endpoints
export const OwnerDescriptor = defineEntityAlias(UserDescriptor, ownerMeta);
export const AssigneeDescriptor = defineEntityAlias(UserDescriptor, assigneeMeta);
export const AuthorDescriptor = defineEntityAlias(UserDescriptor, authorMeta);
