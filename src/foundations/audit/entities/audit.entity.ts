import { Entity } from "../../../common/abstracts/entity";
import { User } from "../../user/entities/user";

export type Audit = Entity & {
  auditType: string;
  changes?: string;

  user: User;
  audited?: any;
};
