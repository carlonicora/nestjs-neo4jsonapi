import { Entity } from "../../../common/abstracts/entity";
import { Company } from "../../company/entities/company";
import { Module } from "../../module/entities/module.entity";
import { Role } from "../../role/entities/role.entity";

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

  // GDPR consent fields
  termsAcceptedAt?: Date;
  marketingConsent?: boolean;
  marketingConsentAt?: Date;

  role?: Role[];
  company?: Company;
  module?: Module[];
};
