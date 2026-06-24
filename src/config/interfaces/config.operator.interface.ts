export interface ConfigOperatorInterface {
  /**
   * Days an operator approval may stay pending before it expires.
   * The checkpoint TTL is computed as (approvalTtlDays + 1) days.
   * @default 7
   */
  approvalTtlDays?: number;
}
