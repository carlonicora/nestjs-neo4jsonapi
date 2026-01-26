// Module
export { WaitlistModule } from "./waitlist.module";

// Service
export { WaitlistService } from "./services/waitlist.service";

// Entity
export { Waitlist, WaitlistDescriptor, WaitlistStatus } from "./entities/waitlist";
export type { WaitlistDescriptorType } from "./entities/waitlist";

// Meta
export { waitlistMeta } from "./entities/waitlist.meta";

// Repository (exported for testing)
export { WaitlistRepository } from "./repositories/waitlist.repository";

// DTOs
export {
  WaitlistInviteBatchAttributesDTO,
  WaitlistInviteBatchDataDTO,
  WaitlistInviteBatchDTO,
} from "./dtos/waitlist.invite.dto";
export { WaitlistPostAttributesDTO, WaitlistPostDataDTO, WaitlistPostDTO } from "./dtos/waitlist.post.dto";
