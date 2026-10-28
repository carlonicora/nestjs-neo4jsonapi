import { CommunityDescriptor } from "./entities/community.entity";

export { Community, CommunityDescriptor, CommunityDescriptorType } from "./entities/community.entity";
export { communityMeta } from "./entities/community.meta";
export { CommunityModule } from "./community.module";
export { CommunityRepository } from "./repositories/community.repository";
export { CommunityService } from "./services/community.service";
export { CommunityLayer, CommunityLayerService } from "./services/community-layer.service";

/** @deprecated Use CommunityDescriptor.model. */
export const CommunityModel = CommunityDescriptor.model;
