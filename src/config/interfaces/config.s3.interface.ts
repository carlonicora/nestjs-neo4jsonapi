export interface ConfigS3Interface {
  type: string;
  region: string;
  bucket: string;
  key: string;
  secret: string;
  endpoint: string;
  /**
   * Seconds for which a signed read link stays identical, so browser and image
   * proxy caches can hit. Defaults to 3600.
   */
  signingWindowSeconds: number;
}
