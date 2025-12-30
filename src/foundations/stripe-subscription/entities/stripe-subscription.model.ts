import { DataModelInterface } from "../../../common/interfaces/datamodel.interface";
import { billingCustomerMeta } from "../../stripe/entities/billing-customer.meta";
import { stripePriceMeta } from "../../stripe-price/entities/stripe-price.meta";
import { StripeSubscription } from "./stripe-subscription.entity";
import { mapStripeSubscription } from "./stripe-subscription.map";
import { stripeSubscriptionMeta } from "./stripe-subscription.meta";
import { StripeSubscriptionSerialiser } from "../serialisers/stripe-subscription.serialiser";

export const StripeSubscriptionModel: DataModelInterface<StripeSubscription> = {
  ...stripeSubscriptionMeta,
  entity: undefined as unknown as StripeSubscription,
  mapper: mapStripeSubscription,
  serialiser: StripeSubscriptionSerialiser,
  singleChildrenTokens: [billingCustomerMeta.nodeName, stripePriceMeta.nodeName],
  childrenTokens: [],
};
