import { defineEntity, type Entity } from "../../../common";
import { offlineChangeSetMeta } from "./offline-change-set.meta";

/** One change the device queued while offline, as the request carries it. */
export type OfflineChange = {
  seq: number;
  method: "POST" | "PUT" | "PATCH" | "DELETE";
  /** Relative to the API base, as EndpointCreator built it. */
  path: string;
  /** The JSON:API document the model built when the GM saved. */
  body?: Record<string, unknown>;
  /** Set for an edit or delete of one record. */
  recordType?: string;
  recordId?: string;
  /** The record's JSON:API resource as of the last sync. */
  base?: Record<string, unknown> | null;
  /**
   * The GM's answer to an earlier conflict. The change keeps its original method, path, body
   * and base; the server merges again and settles each conflicting field by its choice.
   */
  resolution?: OfflineChangeResolution;
};

/** Whose value a conflicting field takes: the device's, the server's, or the hand-merged one. */
export type OfflineFieldChoice = "mine" | "theirs" | "merged";

export type OfflineChangeResolution = {
  /** "mine" = every conflicting field "mine"; "merged" = per field, from `choices`. */
  kind: "mine" | "merged";
  /** Per conflicting field (attribute or relationship name): whose value wins. */
  choices?: Record<string, OfflineFieldChoice>;
  /**
   * The JSON:API document the record type's model built holding only the fields chosen
   * "merged", with their hand-merged values (read from `data.attributes`).
   */
  mergedBody?: Record<string, unknown>;
};

/** What the server did with one change. */
export type OfflineChangeResult = {
  seq: number;
  status: "applied" | "conflict" | "could-not-apply" | "waiting";
  conflict?: "fields" | "deleted-on-server" | "changed-on-server";
  /** JSON:API resource as it is now on the server. */
  current?: Record<string, unknown> | null;
  /** Attributes the merge settled (for the conflict screen). */
  merged?: Record<string, unknown>;
  conflictFields?: string[];
  /** Rich-text field → conflicting block ids. */
  conflictBlocks?: Record<string, string[]>;
  /** The server's reason for could-not-apply. */
  detail?: string;
  /** JSON:API document the route answered, when applied. */
  response?: Record<string, unknown>;
};

/**
 * The answer to one offline change set (one package of every change the device queued).
 *
 * Stored as an `OfflineChangeSet` node of the caller's company once the package has been
 * opened, so a package the device sends again (same id) is answered with the same results
 * and never applied twice. The node keeps the results as the JSON string `resultsJson`, which
 * never goes on the wire; `results` is derived from it (or taken as given for a package just
 * opened) and is what the answer carries in `attributes`.
 */
export type OfflineChangeSet = Entity & {
  results?: OfflineChangeResult[];
  resultsJson?: string;
};

export const OfflineChangeSetDescriptor = defineEntity<OfflineChangeSet>()({
  ...offlineChangeSetMeta,

  isCompanyScoped: true,

  fields: {
    resultsJson: { type: "string", excludeFromJsonApi: true, excludeFromSearch: true },
  },

  // Derived, output-only: a virtual field, because the serialiser emits a `computed` value only
  // into meta (`computedDef.meta`) or nowhere, and the answer carries `results` in attributes.
  virtualFields: {
    results: {
      compute: ({ data }) => {
        if (Array.isArray(data?.results)) return data.results;
        try {
          const parsed = JSON.parse(data?.resultsJson ?? "[]");
          return Array.isArray(parsed) ? parsed : [];
        } catch {
          return [];
        }
      },
    },
  },

  relationships: {},
});

export type OfflineChangeSetDescriptorType = typeof OfflineChangeSetDescriptor;
