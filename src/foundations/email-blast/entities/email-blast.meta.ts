import { DataMeta } from "../../../common/interfaces/datamodel.interface";

export const emailBlastMeta: DataMeta = {
  type: "email-blasts",
  endpoint: "email-blasts",
  nodeName: "emailBlast",
  labelName: "EmailBlast",
};

/** Public unsubscribe route segment: `email-blasts/unsubscribe/:token`. */
export const EMAIL_BLAST_UNSUBSCRIBE_SEGMENT = "unsubscribe";

/** JSON:API type of the unsubscribe request body. */
export const EMAIL_BLAST_UNSUBSCRIBE_TYPE = "email-blast-unsubscribes";

/** Admin route segment: `email-blasts/:emailBlastId/test`. */
export const EMAIL_BLAST_TEST_SEGMENT = "test";

/** Admin route segment: `email-blasts/:emailBlastId/send`. */
export const EMAIL_BLAST_SEND_SEGMENT = "send";

/** Admin route segment: `email-blasts/:emailBlastId/recipient-count`. */
export const EMAIL_BLAST_AUDIENCE_SEGMENT = "recipient-count";
