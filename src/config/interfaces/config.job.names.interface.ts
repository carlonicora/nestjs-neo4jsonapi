/**
 * Configuration for job names used in BullMQ processors.
 *
 * Apps define their job names and pass them through config.
 * The library uses these to match incoming jobs in processors.
 */
export interface ConfigJobNamesInterface {
  /**
   * Job names for processing operations.
   * Key is the content type labelName (e.g., "Article", "Document")
   * Value is the job name string (e.g., "process_article", "process_document")
   * Special key "chunk" is used for chunk processing.
   */
  process: Record<string, string>;

  /**
   * Job names for notification operations.
   */
  notifications?: Record<string, string>;
}
