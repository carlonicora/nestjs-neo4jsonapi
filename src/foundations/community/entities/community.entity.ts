import { Entity } from "../../../common/abstracts/entity";
import { Company } from "../../company";
import { KeyConcept } from "../../keyconcept";

export type Community = Entity & {
  name: string;
  summary: string;
  embedding?: any;
  level: number;
  rating: number;
  memberCount: number;
  isStale: boolean;
  staleSince?: Date;
  lastProcessedAt?: Date;
  /** Deferred for lack of credits — the summariser cron skips these until approval clears the flag (spec §2). */
  pendingCredits?: boolean;

  company: Company;
  keyconcept: KeyConcept[];
  community: Community;
};
