/**
 * Queue ID configuration
 * Consumers should extend this enum with their own queue IDs
 */
export enum QueueId {
  ACCOUNT_DELETION = "account-deletion",
  ANALYTICS = "analytics",
  CHUNK = "chunk",
  COMPANY = "company",
  COMPANY_DELETION = "company-deletion",
  COMMUNITY_SUMMARISER = "community-summariser",
  BILLING_WEBHOOK = "billing-webhook",
  BLOG = "blog",
  EMAIL = "email",
  HOWTO = "howto",
  HANDBOOK_PAGE = "handbookpage",
  TRIAL = "trial",
  USER_ACTIVITY = "user-activity",
}
