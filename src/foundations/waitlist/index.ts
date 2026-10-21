// Module
export { WaitlistModule } from "./waitlist.module";

// Service
export { WaitlistService } from "./services/waitlist.service";

// Entity
export { Waitlist, WaitlistDescriptor, WaitlistStatus } from "./entities/waitlist";
export type { WaitlistDescriptorType } from "./entities/waitlist";

// Meta
export { waitlistMeta } from "./entities/waitlist.meta";

// Events
export { WAITLIST_CONFIRMED_EVENT } from "./events/waitlist.events";
export type { WaitlistConfirmedEvent } from "./events/waitlist.events";

// Signup source
export {
  SIGNUP_SOURCE_FIELDS,
  SIGNUP_SOURCE_MAX_LENGTH,
  hasSignupSource,
  parseSignupSourceParam,
  sanitiseSignupSource,
} from "./utils/signup-source";
export type { SignupSource } from "./utils/signup-source";

// Repository (exported for testing)
export { WaitlistRepository } from "./repositories/waitlist.repository";

// DTOs
export {
  WaitlistInviteBatchAttributesDTO,
  WaitlistInviteBatchDataDTO,
  WaitlistInviteBatchDTO,
} from "./dtos/waitlist.invite.dto";
export { WaitlistPostAttributesDTO, WaitlistPostDataDTO, WaitlistPostDTO } from "./dtos/waitlist.post.dto";
