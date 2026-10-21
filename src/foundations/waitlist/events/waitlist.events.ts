import { Waitlist } from "../entities/waitlist";

/** Emitted by `WaitlistService.confirm` once a waitlist entry is confirmed. */
export const WAITLIST_CONFIRMED_EVENT = "waitlist.confirmed";

export type WaitlistConfirmedEvent = { waitlist: Waitlist };
