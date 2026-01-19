/**
 * Queue ID configuration
 * Consumers should extend this enum with their own queue IDs
 */
export enum QueueId {
  CHUNK = "chunk",
  COMPANY = "company",
  COMPANY_DELETION = "company-deletion",
  COMMUNITY_SUMMARISER = "community-summariser",
  BILLING_WEBHOOK = "billing-webhook",
  EMAIL = "email",
  TRIAL = "trial",
}
