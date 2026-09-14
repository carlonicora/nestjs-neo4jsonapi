export interface DataLimits {
  /** Bypass company filtering and retrieve over HowTo content only. */
  howToMode?: boolean;
  /** Restrict retrieval to chunks of a single HowTo node. */
  limitToHowToId?: string;
  /** Bypass company filtering and retrieve over handbook documentation only. */
  handbookMode?: boolean;
  /** Restrict retrieval to chunks of a single HandbookPage node. */
  limitToHandbookPageId?: string;
}
