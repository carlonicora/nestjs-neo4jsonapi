import { DataModelInterface } from "../../../common/interfaces/datamodel.interface";
import { StripePaymentMethodSerialiser } from "../serialisers/stripe-payment-method.serialiser";
import { StripePaymentMethod } from "./stripe-payment-method.entity";
import { stripePaymentMethodMeta } from "./stripe-payment-method.meta";

/**
 * Model definition for StripePaymentMethod
 *
 * Payment methods are transient (not stored in Neo4j), so we don't need
 * mapper, singleChildrenTokens, or childrenTokens.
 */
export const StripePaymentMethodModel: DataModelInterface<StripePaymentMethod> = {
  ...stripePaymentMethodMeta,
  entity: undefined as unknown as StripePaymentMethod,
  mapper: undefined as any,
  serialiser: StripePaymentMethodSerialiser,
  singleChildrenTokens: [],
  childrenTokens: [],
};
