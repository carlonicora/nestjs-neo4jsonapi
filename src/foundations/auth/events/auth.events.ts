import { User } from "../../user/entities/user";

/** Emitted when a user completes registration: account activation or OAuth sign-up. */
export const USER_ACTIVATED_EVENT = "user.activated";

export type UserActivatedEvent = { user: User };
