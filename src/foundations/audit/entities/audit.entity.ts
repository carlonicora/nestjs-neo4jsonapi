import { Entity } from "../../../common/abstracts/entity";
import { User } from "../../user/entities/user";

export type AuditLog = Entity & {
  action: string;
  entity_type: string;
  entity_id: string;
  field_name?: string;
  old_value?: string;
  new_value?: string;
  ip_address?: string;
  company_id?: string;

  user: User;
  audited?: any;
};
