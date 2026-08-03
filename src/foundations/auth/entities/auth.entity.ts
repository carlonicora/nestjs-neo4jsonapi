import { Entity } from "../../../common/abstracts/entity";
import { User } from "../../user/entities/user";

export type Auth = Entity & {
  token: string;
  expiration: Date;
  user?: User;

  /**
   * Transient, output-only login-flow fields — never stored on the Auth node.
   *
   * When a user belongs to more than one company the credentials check succeeds but
   * no session is created yet: the response carries `requiresCompanySelection: true`
   * plus a short-lived `selectionToken` scoped to company selection, and the client
   * exchanges it for a full company-scoped token once a company has been chosen.
   */
  requiresCompanySelection?: boolean;
  selectionToken?: string;
};
