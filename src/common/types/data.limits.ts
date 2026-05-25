export type DataLimits = {
  /** Bypass company filtering and retrieve over HowTo content only. */
  howToMode?: boolean;
  /** Restrict retrieval to chunks of a single HowTo node. */
  limitToHowToId?: string;
};
