export interface ConfigOperatorInterface {
  /**
   * Days an operator approval may stay pending before it expires.
   * The checkpoint TTL is computed as (approvalTtlDays + 1) days.
   * @default 7
   */
  approvalTtlDays?: number;
  /**
   * Whether the operator gets the search_communities tool.
   * @default true — set false to omit the search_communities (DRIFT) tool for hosts with no :Community nodes
   */
  communitySearch?: boolean;
}
