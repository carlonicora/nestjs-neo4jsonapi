import { describe, it, expect } from "vitest";
import { sanitizeTldr } from "../tldr.sanitizer";

describe("sanitizeTldr", () => {
  describe("plain text pass-through", () => {
    it("returns plain prose unchanged", () => {
      expect(sanitizeTldr("Summary of the document in one sentence.")).toBe("Summary of the document in one sentence.");
    });
  });

  describe("inline emphasis", () => {
    it("strips bold markers", () => {
      expect(sanitizeTldr("**Important**: the request was rejected.")).toBe("Important: the request was rejected.");
    });

    it("strips italic underscores", () => {
      expect(sanitizeTldr("Result _positive_ for the customer.")).toBe("Result positive for the customer.");
    });

    it("strips backticks", () => {
      expect(sanitizeTldr("Reference to the `main section`.")).toBe("Reference to the main section.");
    });

    it("strips strikethrough markers", () => {
      expect(sanitizeTldr("Outcome ~~cancelled~~ confirmed.")).toBe("Outcome cancelled confirmed.");
    });
  });

  describe("line-leading block markers", () => {
    it("strips headings and collapses the newline to a space", () => {
      expect(sanitizeTldr("# Title\nContent")).toBe("Title Content");
    });

    it("strips unordered bullet lists and collapses newlines to spaces", () => {
      expect(sanitizeTldr("- point one\n- point two")).toBe("point one point two");
    });

    it("strips ordered list numbers and collapses newlines to spaces", () => {
      expect(sanitizeTldr("1. first\n2. second")).toBe("first second");
    });

    it("strips blockquote markers", () => {
      expect(sanitizeTldr("> relevant quotation")).toBe("relevant quotation");
    });
  });

  describe("horizontal rules", () => {
    it("removes dash horizontal rule lines between content", () => {
      expect(sanitizeTldr("Before\n---\nAfter")).toBe("Before After");
    });

    it("removes asterisk horizontal rule lines", () => {
      expect(sanitizeTldr("Before\n***\nAfter")).toBe("Before After");
    });
  });

  describe("links and images", () => {
    it("unwraps markdown links keeping link text", () => {
      expect(sanitizeTldr("See [Reference](https://example.com) for the case")).toBe("See Reference for the case");
    });

    it("unwraps image syntax keeping alt text", () => {
      expect(sanitizeTldr("![logo](url) text")).toBe("logo text");
    });
  });

  describe("combined markdown", () => {
    it("handles bold wrapping a link and a neighbouring italic", () => {
      expect(sanitizeTldr("**[Section 123](url)** _essential_")).toBe("Section 123 essential");
    });
  });

  describe("whitespace normalisation", () => {
    it("collapses tabs, multi-space and CRLF into single spaces and trims", () => {
      expect(sanitizeTldr("  first\t\tsecond \r\n third  ")).toBe("first second third");
    });
  });

  describe("edge cases", () => {
    it("returns empty string for empty input", () => {
      expect(sanitizeTldr("")).toBe("");
    });

    it("returns empty string for whitespace-only input", () => {
      expect(sanitizeTldr("   \n\t  ")).toBe("");
    });
  });

  describe("idempotence", () => {
    it("running twice produces the same result as running once", () => {
      const inputs = [
        "**Bold** text",
        "# Heading\n- item",
        "Plain text",
        "[Link](url) in sentence",
        "![img](url) caption",
        "---",
        "",
      ];
      for (const input of inputs) {
        const once = sanitizeTldr(input);
        const twice = sanitizeTldr(once);
        expect(twice).toBe(once);
      }
    });
  });
});
