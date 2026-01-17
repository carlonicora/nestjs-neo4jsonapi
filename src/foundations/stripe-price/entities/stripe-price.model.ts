import { DataModelInterface } from "../../../common/interfaces/datamodel.interface";
import { StripePrice } from "../entities/stripe-price.entity";
import { mapStripePrice } from "../entities/stripe-price.map";
import { stripePriceMeta } from "../entities/stripe-price.meta";
import { stripeProductMeta } from "../../stripe-product/entities/stripe-product.meta";
import { StripePriceSerialiser } from "../serialisers/stripe-price.serialiser";
import { featureMeta } from "../../feature/entities/feature.meta";

export const StripePriceModel: DataModelInterface<StripePrice> = {
  ...stripePriceMeta,
  entity: undefined as unknown as StripePrice,
  mapper: mapStripePrice,
  serialiser: StripePriceSerialiser,
  singleChildrenTokens: [stripeProductMeta.nodeName],
  childrenTokens: [featureMeta.nodeName],
};
