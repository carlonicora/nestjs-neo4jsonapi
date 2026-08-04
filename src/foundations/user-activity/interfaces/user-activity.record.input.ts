/**
 * Input accepted by `UserActivityService.record()` / `UserActivityRepository.createActivity()`.
 *
 * `category` and `action` are open strings on purpose: the library does not own
 * the taxonomy. Consuming apps keep their own enums (e.g. `UserActivityCategory`
 * / `UserActivityAction`) and pass their members straight through — every string
 * enum member is assignable to `string`.
 */
export interface UserActivityRecordInput {
  userId: string;
  companyId: string;
  category: string;
  action: string;
  entityType?: string;
  entityId?: string;
  metadata?: Record<string, unknown>;
}
