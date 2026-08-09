export interface ConfigStripeInterface {
  secretKey: string;
  publishableKey: string;
  webhookSecret: string;
  apiVersion?: string;
  portalReturnUrl: string;
  portalConfigurationId: string;
}
