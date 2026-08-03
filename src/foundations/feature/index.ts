import { FeatureDescriptor as _FeatureDescriptor } from "./entities/feature";

export { FeatureModule } from "./feature.module";
export { Feature, FeatureDescriptor, FeatureDescriptorType } from "./entities/feature";
export { featureMeta } from "./entities/feature.meta";
export { FeatureModel } from "./entities/feature.model";
export { FeatureRepository } from "./repositories/feature.repository";
export { FeatureService } from "./services/feature.service";
export { FeatureDTO, FeatureDataDTO, FeatureDataListDTO } from "./dtos/feature.dto";

/**
 * Compat alias: the hand-written FeatureSerialiser class was replaced by the
 * descriptor's auto-generated serialiser. The exported name is kept so existing
 * consumers (DI providers, serialiser factories) keep resolving.
 */
export const FeatureSerialiser = _FeatureDescriptor.model.serialiser;
