import { BadRequestException } from "@nestjs/common";
import { existsSync } from "node:fs";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ChunkerService, ChunkerSourceFetcher } from "../chunker.service";

/**
 * The chunker's source gate: it reads storage keys, this API's own signed object links, and
 * (only when the application binds CHUNKER_SOURCE_FETCHER) other URLs. It never makes a bare
 * `fetch` and never reads a local path a caller names. Its decrypted working copy is removed on
 * every path. No fs mock here: the temp file is real, so its removal is observed on disk.
 */

const API_URL = "https://api.test/";

const makeConfig = () =>
  ({
    get: vi.fn((key: string) => {
      if (key === "ai") return { mock: false };
      if (key === "api") return { url: API_URL };
      if (key === "chunker") return { strategy: "markdown-structural", ocrLanguage: "eng", targetChars: 1500 };
      return undefined;
    }),
  }) as any;

const stub = {} as any;

describe("ChunkerService source gate", () => {
  let fetchSpy: ReturnType<typeof vi.fn>;
  let s3: { downloadFileBuffer: ReturnType<typeof vi.fn> };
  let cipher: { verifyObjectToken: ReturnType<typeof vi.fn> };
  let invoke: ReturnType<typeof vi.fn>;
  let pdfService: { extractPdfContent: ReturnType<typeof vi.fn>; getRawElements: ReturnType<typeof vi.fn> };
  let docxService: { getRawElements: ReturnType<typeof vi.fn>; convertToMarkdown: ReturnType<typeof vi.fn> };

  beforeEach(() => {
    fetchSpy = vi.fn().mockResolvedValue({
      ok: true,
      statusText: "OK",
      headers: { get: () => "application/pdf" },
      arrayBuffer: async () => new ArrayBuffer(8),
    });
    vi.stubGlobal("fetch", fetchSpy);
    s3 = {
      downloadFileBuffer: vi
        .fn()
        .mockResolvedValue({ buffer: Buffer.from("%PDF-stored"), contentType: "application/pdf" }),
    };
    cipher = { verifyObjectToken: vi.fn() };
    invoke = vi.fn().mockResolvedValue({ content: "an image description" });
    pdfService = {
      extractPdfContent: vi.fn().mockResolvedValue({
        content: [{ type: "paragraph", content: "some extracted pdf text" }],
        totalPages: 1,
      }),
      getRawElements: vi.fn(),
    };
    docxService = { getRawElements: vi.fn(), convertToMarkdown: vi.fn() };
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.clearAllMocks();
  });

  const makeService = (opts: { fetcher?: ChunkerSourceFetcher; withCipher?: boolean } = {}) => {
    const splitter = { splitMarkdownToChunks: vi.fn().mockResolvedValue([]) } as any;
    const modelService = { getLLM: vi.fn().mockReturnValue({ invoke }) } as any;
    return new ChunkerService(
      splitter,
      splitter,
      docxService as any,
      stub,
      pdfService as any,
      stub,
      modelService,
      s3 as any,
      stub,
      makeConfig(),
      undefined,
      undefined,
      opts.withCipher === false ? undefined : (cipher as any),
      opts.fetcher,
    );
  };

  describe("remote URLs are refused by default", () => {
    it.each([
      "http://169.254.169.254/latest/meta-data/iam.pdf",
      "https://internal.service.local/secret.pdf",
      "https://example.com/report.pdf",
    ])("generateContentStructureFromFile refuses %s without any request", async (url) => {
      await expect(makeService().generateContentStructureFromFile({ fileType: "pdf", filePath: url })).rejects.toThrow(
        BadRequestException,
      );

      expect(fetchSpy).not.toHaveBeenCalled();
      expect(s3.downloadFileBuffer).not.toHaveBeenCalled();
      expect(pdfService.extractPdfContent).not.toHaveBeenCalled();
    });

    it("an image URL is not fetched and never reaches the vision model", async () => {
      const docs = await makeService().generateContentStructureFromFile({
        fileType: "png",
        filePath: "http://169.254.169.254/latest/meta-data/x.png",
      });

      expect(docs).toEqual([]);
      expect(fetchSpy).not.toHaveBeenCalled();
      expect(invoke).not.toHaveBeenCalled();
    });

    it("extractContentFromUrl refuses a URL without any request", async () => {
      await expect(makeService().extractContentFromUrl({ url: "http://10.0.0.5/admin" })).rejects.toThrow(
        BadRequestException,
      );
      expect(fetchSpy).not.toHaveBeenCalled();
    });

    it("an object link on another host, shaped like this API's, is still refused", async () => {
      cipher.verifyObjectToken.mockReturnValue({ o: "get", k: "companies/c1/a.pdf" });

      await expect(
        makeService().generateContentStructureFromFile({
          fileType: "pdf",
          filePath: "https://evil.test/s3/objects/tok",
        }),
      ).rejects.toThrow(BadRequestException);
      expect(cipher.verifyObjectToken).not.toHaveBeenCalled();
      expect(fetchSpy).not.toHaveBeenCalled();
    });

    it("an object link on this API with a token the server did not sign is refused", async () => {
      cipher.verifyObjectToken.mockImplementation(() => {
        throw new Error("bad signature");
      });

      await expect(
        makeService().generateContentStructureFromFile({ fileType: "pdf", filePath: `${API_URL}s3/objects/forged` }),
      ).rejects.toThrow(BadRequestException);
      expect(s3.downloadFileBuffer).not.toHaveBeenCalled();
      expect(fetchSpy).not.toHaveBeenCalled();
    });
  });

  describe("local paths are refused", () => {
    it.each([
      "/etc/passwd",
      "/tmp/temp-file.other-tenant.pdf",
      "C:\\Windows\\win.ini",
      "file:///etc/passwd",
      "../../etc/passwd",
    ])("refuses %s", async (filePath) => {
      await expect(makeService().generateContentStructureFromFile({ fileType: "pdf", filePath })).rejects.toThrow(
        BadRequestException,
      );
      expect(s3.downloadFileBuffer).not.toHaveBeenCalled();
      expect(pdfService.extractPdfContent).not.toHaveBeenCalled();
    });
  });

  describe("allowed sources", () => {
    it("reads this API's own signed object link from storage by its key, with no request", async () => {
      cipher.verifyObjectToken.mockReturnValue({ o: "get", k: "companies/c1/a.pdf" });

      await makeService().generateContentStructureFromFile({
        fileType: "pdf",
        filePath: `${API_URL}s3/objects/tok.sig`,
      });

      expect(cipher.verifyObjectToken).toHaveBeenCalledWith("tok.sig", "get");
      expect(s3.downloadFileBuffer).toHaveBeenCalledWith({ key: "companies/c1/a.pdf" });
      expect(fetchSpy).not.toHaveBeenCalled();
    });

    it("hands any other URL to the bound CHUNKER_SOURCE_FETCHER, never to a bare fetch", async () => {
      const fetcher = { fetch: vi.fn().mockResolvedValue({ buffer: Buffer.from("%PDF-remote") }) };

      await makeService({ fetcher }).generateContentStructureFromFile({
        fileType: "pdf",
        filePath: "https://example.com/report.pdf",
      });

      expect(fetcher.fetch).toHaveBeenCalledWith({ url: "https://example.com/report.pdf" });
      expect(fetchSpy).not.toHaveBeenCalled();
      expect(pdfService.extractPdfContent).toHaveBeenCalled();
    });

    it("propagates the fetcher's refusal (an SSRF-guarded fetcher blocking a private address)", async () => {
      const fetcher = { fetch: vi.fn().mockRejectedValue(new BadRequestException("private address")) };

      await expect(
        makeService({ fetcher }).generateContentStructureFromFile({
          fileType: "pdf",
          filePath: "http://127.0.0.1/x.pdf",
        }),
      ).rejects.toThrow("private address");
      expect(fetchSpy).not.toHaveBeenCalled();
    });
  });

  describe("the decrypted working copy", () => {
    it("is removed after a successful read", async () => {
      let workingCopy = "";
      pdfService.extractPdfContent.mockImplementation(async (localFilePath: string) => {
        workingCopy = localFilePath;
        expect(existsSync(localFilePath)).toBe(true);
        return { content: [{ type: "paragraph", content: "text" }], totalPages: 1 };
      });

      await makeService().generateContentStructureFromFile({ fileType: "pdf", filePath: "companies/c1/a.pdf" });

      expect(workingCopy).not.toBe("");
      expect(existsSync(workingCopy)).toBe(false);
    });

    it("is removed when parsing fails (a docx refused by the zip limits)", async () => {
      let workingCopy = "";
      docxService.getRawElements.mockImplementation(async (localFilePath: string) => {
        workingCopy = localFilePath;
        expect(existsSync(localFilePath)).toBe(true);
        throw new BadRequestException("DOCX: entry word/document.xml expands beyond 67108864 bytes");
      });

      await expect(
        makeService().generateContentStructureFromFile({ fileType: "docx", filePath: "companies/c1/bomb.docx" }),
      ).rejects.toThrow(BadRequestException);

      expect(workingCopy).not.toBe("");
      expect(existsSync(workingCopy)).toBe(false);
    });
  });
});
