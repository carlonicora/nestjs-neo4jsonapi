import { describe, expect, it } from "vitest";
import { USER_ACTIVATED_EVENT } from "../../auth/events/auth.events";
import { WAITLIST_CONFIRMED_EVENT } from "../../waitlist/events/waitlist.events";
import { userActivatedTrigger, waitlistConfirmedTrigger } from "../triggers/built-in.triggers";

describe("built-in email automation triggers", () => {
  describe("waitlistConfirmedTrigger", () => {
    it("declares the key, the default label and the waitlist event", () => {
      const trigger = waitlistConfirmedTrigger("x");

      expect(trigger.key).toBe("x");
      expect(trigger.label).toBe("Waitlist confirmed");
      expect(trigger.event).toBe(WAITLIST_CONFIRMED_EVENT);
    });

    it("takes a custom label", () => {
      expect(waitlistConfirmedTrigger("x", "Joined the list").label).toBe("Joined the list");
    });

    it("maps the waitlist entry to a recipient", () => {
      const recipient = waitlistConfirmedTrigger("x").toRecipient({
        waitlist: { id: "waitlist-1", email: "gm@example.com", marketingConsent: true },
      });

      expect(recipient).toEqual({
        email: "gm@example.com",
        recipientType: "waitlist",
        recipientId: "waitlist-1",
        marketingConsent: true,
      });
    });

    it("treats a missing marketing consent as false", () => {
      const recipient = waitlistConfirmedTrigger("x").toRecipient({
        waitlist: { id: "waitlist-1", email: "gm@example.com" },
      });

      expect(recipient?.marketingConsent).toBe(false);
    });

    it("returns null for a payload without a waitlist entry", () => {
      expect(waitlistConfirmedTrigger("x").toRecipient({})).toBeNull();
      expect(waitlistConfirmedTrigger("x").toRecipient(undefined)).toBeNull();
    });
  });

  describe("userActivatedTrigger", () => {
    it("declares the key, the default label and the user event", () => {
      const trigger = userActivatedTrigger("y");

      expect(trigger.key).toBe("y");
      expect(trigger.label).toBe("Registration completed");
      expect(trigger.event).toBe(USER_ACTIVATED_EVENT);
    });

    it("takes a custom label", () => {
      expect(userActivatedTrigger("y", "Signed up").label).toBe("Signed up");
    });

    it("maps the user to a recipient with the name", () => {
      const recipient = userActivatedTrigger("y").toRecipient({
        user: { id: "user-1", email: "gm@example.com", name: "GM", marketingConsent: true },
      });

      expect(recipient).toEqual({
        email: "gm@example.com",
        name: "GM",
        recipientType: "user",
        recipientId: "user-1",
        marketingConsent: true,
      });
    });

    it("treats a missing marketing consent as false", () => {
      const recipient = userActivatedTrigger("y").toRecipient({
        user: { id: "user-1", email: "gm@example.com", name: "GM" },
      });

      expect(recipient?.marketingConsent).toBe(false);
    });

    it("returns null for a payload without a user", () => {
      expect(userActivatedTrigger("y").toRecipient({})).toBeNull();
      expect(userActivatedTrigger("y").toRecipient(null)).toBeNull();
    });
  });
});
