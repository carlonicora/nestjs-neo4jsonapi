/**
 * The closed sets of values the administrative analytics endpoints accept. The
 * controller validates query params against these tuples and the unions below
 * are derived from them, so there is one declaration of each set.
 */

/** The two audiences of the administrative analytics page. */
export const AUDIENCES = ["visitors", "users"] as const;
export type Audience = (typeof AUDIENCES)[number];

export const GRANULARITIES = ["day", "week", "month"] as const;
export type Granularity = (typeof GRANULARITIES)[number];

export const DIMENSIONS = ["source", "medium", "campaign", "referrer", "route", "landing", "exit"] as const;
export type Dimension = (typeof DIMENSIONS)[number];
