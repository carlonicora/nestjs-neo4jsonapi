import { describe, it, expect, beforeEach } from "vitest";
import { OAuthPkceService } from "./oauth.pkce.service";

describe("OAuthPkceService", () => {
  let pkceService: OAuthPkceService;

  beforeEach(() => {
    pkceService = new OAuthPkceService();
  });

  describe("generateCodeVerifier", () => {
    it("should generate a verifier of default length (64)", () => {
      const verifier = pkceService.generateCodeVerifier();
      expect(verifier).toHaveLength(64);
    });

    it("should generate a verifier of specified length", () => {
      const verifier = pkceService.generateCodeVerifier(80);
      expect(verifier).toHaveLength(80);
    });

    it("should clamp length to minimum 43", () => {
      const verifier = pkceService.generateCodeVerifier(10);
      expect(verifier).toHaveLength(43);
    });

    it("should clamp length to maximum 128", () => {
      const verifier = pkceService.generateCodeVerifier(200);
      expect(verifier).toHaveLength(128);
    });

    it("should only use valid characters", () => {
      const verifier = pkceService.generateCodeVerifier();
      expect(verifier).toMatch(/^[A-Za-z0-9\-._~]+$/);
    });

    it("should generate unique verifiers", () => {
      const verifier1 = pkceService.generateCodeVerifier();
      const verifier2 = pkceService.generateCodeVerifier();
      expect(verifier1).not.toBe(verifier2);
    });
  });

  describe("generateCodeChallenge", () => {
    it("should generate S256 challenge correctly", () => {
      // Known test vector from RFC 7636 Appendix B
      const verifier = "dBjftJeZ4CVP-mB92K27uhbUJU1p1r_wW1gFWFOEjXk";
      const challenge = pkceService.generateCodeChallenge(verifier, "S256");
      expect(challenge).toBe("E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM");
    });

    it("should return verifier for plain method", () => {
      const verifier = "test-verifier-12345-abcdefghijklmnop";
      const challenge = pkceService.generateCodeChallenge(verifier, "plain");
      expect(challenge).toBe(verifier);
    });
  });

  describe("validateCodeChallenge", () => {
    it("should validate correct S256 verifier", () => {
      const verifier = pkceService.generateCodeVerifier();
      const challenge = pkceService.generateCodeChallenge(verifier, "S256");
      expect(pkceService.validateCodeChallenge(verifier, challenge, "S256")).toBe(true);
    });

    it("should validate correct plain verifier", () => {
      const verifier = pkceService.generateCodeVerifier();
      const challenge = pkceService.generateCodeChallenge(verifier, "plain");
      expect(pkceService.validateCodeChallenge(verifier, challenge, "plain")).toBe(true);
    });

    it("should reject incorrect verifier", () => {
      const verifier = pkceService.generateCodeVerifier();
      const challenge = pkceService.generateCodeChallenge(verifier, "S256");
      const wrongVerifier = pkceService.generateCodeVerifier();
      expect(pkceService.validateCodeChallenge(wrongVerifier, challenge, "S256")).toBe(false);
    });

    it("should reject invalid verifier format", () => {
      const challenge = "some-challenge";
      expect(pkceService.validateCodeChallenge("too-short", challenge, "S256")).toBe(false);
    });
  });

  describe("isValidVerifier", () => {
    it("should accept valid verifier", () => {
      const verifier = pkceService.generateCodeVerifier();
      expect(pkceService.isValidVerifier(verifier)).toBe(true);
    });

    it("should reject too short verifier", () => {
      expect(pkceService.isValidVerifier("short")).toBe(false);
    });

    it("should reject too long verifier", () => {
      const longVerifier = "a".repeat(129);
      expect(pkceService.isValidVerifier(longVerifier)).toBe(false);
    });

    it("should reject invalid characters", () => {
      const invalidVerifier = "valid-verifier-but-has-invalid-char-@-here" + "1".repeat(10);
      expect(pkceService.isValidVerifier(invalidVerifier)).toBe(false);
    });
  });

  describe("isValidChallengeMethod", () => {
    it("should accept S256", () => {
      expect(pkceService.isValidChallengeMethod("S256")).toBe(true);
    });

    it("should accept plain", () => {
      expect(pkceService.isValidChallengeMethod("plain")).toBe(true);
    });

    it("should reject invalid method", () => {
      expect(pkceService.isValidChallengeMethod("S384")).toBe(false);
      expect(pkceService.isValidChallengeMethod("invalid")).toBe(false);
    });
  });
});
