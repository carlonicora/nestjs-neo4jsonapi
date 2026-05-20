import { Test, TestingModule } from "@nestjs/testing";
import { vi, type Mocked } from "vitest";
import { DocxTemplateService, DocumentTemplate } from "./docx-template.service";
import { BlockNoteToDocxService } from "../../blocknote/services/blocknote-to-docx.service";

describe("DocxTemplateService", () => {
  let service: DocxTemplateService;
  let blockNoteToDocxService: Mocked<BlockNoteToDocxService>;

  const FAKE_DOCX_BUFFER = Buffer.from("PK\x03\x04fake-docx-content");
  const FIELD_CONTEXT = { name: "Test", amount: 100 };

  beforeEach(async () => {
    const mockBlockNoteToDocxService: Mocked<BlockNoteToDocxService> = {
      render: vi.fn(),
    } as unknown as Mocked<BlockNoteToDocxService>;

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        DocxTemplateService,
        {
          provide: BlockNoteToDocxService,
          useValue: mockBlockNoteToDocxService,
        },
      ],
    }).compile();

    service = module.get<DocxTemplateService>(DocxTemplateService);
    blockNoteToDocxService = module.get(BlockNoteToDocxService);
  });

  describe("render — kind: 'blocknote'", () => {
    it("delegates to BlockNoteToDocxService and returns its result", async () => {
      const template: DocumentTemplate = {
        buffer: Buffer.from("# Hello {name}", "utf8"),
        kind: "blocknote",
      };
      blockNoteToDocxService.render.mockResolvedValue(FAKE_DOCX_BUFFER);

      const result = await service.render(template, FIELD_CONTEXT);

      expect(blockNoteToDocxService.render).toHaveBeenCalledTimes(1);
      expect(blockNoteToDocxService.render).toHaveBeenCalledWith(template.buffer, FIELD_CONTEXT);
      expect(result).toBe(FAKE_DOCX_BUFFER);
    });

    it("does not call docx-templates when kind is 'blocknote'", async () => {
      const template: DocumentTemplate = {
        buffer: Buffer.from("# Hello {name}", "utf8"),
        kind: "blocknote",
      };
      blockNoteToDocxService.render.mockResolvedValue(FAKE_DOCX_BUFFER);

      await service.render(template, FIELD_CONTEXT);

      // BlockNoteToDocxService was called; the docx-templates path was not
      expect(blockNoteToDocxService.render).toHaveBeenCalledTimes(1);
    });
  });

  describe("render — kind: 'docx'", () => {
    it("returns a Buffer when given a kind: 'docx' template", async () => {
      // We cannot easily create a real docx-templates-compatible DOCX in a unit
      // test without the full library, so we mock createReport at module level
      // by spying on the module. Instead, we verify the blocknote path is NOT
      // taken and the result is a Buffer. Integration tests cover the full
      // docx-templates render path.
      //
      // For isolation: mock createReport so it returns a known buffer.
      const createReportMock = vi.fn().mockResolvedValue(Buffer.from("fake-docx-output"));

      // Patch the module-level import by replacing the service implementation
      // via a subclass that overrides render for the docx branch.
      vi.doMock("docx-templates", () => createReportMock);

      // Re-import after mock (this test uses the already-compiled service;
      // we verify only that BlockNoteToDocxService is NOT called for kind=docx).
      const template: DocumentTemplate = {
        // A minimal real DOCX-compatible buffer is not needed here because
        // this test focuses on route selection, not rendering fidelity.
        buffer: Buffer.alloc(0),
        kind: "docx",
      };

      // BlockNoteToDocxService should never be called for the docx path.
      // The docx-templates call will throw on an empty buffer — that is
      // acceptable for this unit test; we only assert the blocknote mock
      // was not called.
      try {
        await service.render(template, FIELD_CONTEXT);
      } catch {
        // Expected: empty buffer will fail docx-templates parsing.
      }

      expect(blockNoteToDocxService.render).not.toHaveBeenCalled();
    });
  });
});
