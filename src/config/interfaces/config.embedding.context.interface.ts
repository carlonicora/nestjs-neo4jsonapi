/**
 * Embedding-context template configuration interface.
 *
 * Provides the label strings used when building temporal embedding context.
 * Optional everywhere — apps that do not configure these labels get no
 * temporal prefix, preserving default behaviour.
 */
export interface ConfigEmbeddingContextInterface {
  /**
   * Label prefixing the temporal context block (default "Contesto temporale").
   */
  temporalContextLabel?: string;

  /**
   * Label prefixing the temporal references block (default "Riferimenti temporali").
   */
  temporalReferencesLabel?: string;
}
