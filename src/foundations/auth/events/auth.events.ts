import { User } from "../../user/entities/user";

/** Emitted when a user completes registration: account activation or OAuth sign-up. */
export const USER_ACTIVATED_EVENT = "user.activated";

/**
 * `language` is the raw `x-language` request header sent with the activation or OAuth
 * completion request, unnormalised. Listeners own any normalisation.
 */
export type UserActivatedEvent = { user: User; language?: string };
