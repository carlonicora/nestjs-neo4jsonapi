import { vi, describe, it, expect, beforeEach, afterEach } from "vitest";
import { Test, TestingModule } from "@nestjs/testing";
import { ClsService } from "nestjs-cls";
import { ConfigService } from "@nestjs/config";
import { getQueueToken } from "@nestjs/bullmq";
import { HowToService } from "./how-to.service";
import { HowToRepository } from "../repositories/how-to.repository";
import { JsonApiService } from "../../../core/jsonapi/services/jsonapi.service";
import { ChunkService } from "../../chunk/services/chunk.service";
import { ChunkerService } from "../../chunker/services/chunker.service";
import { BlockNoteService } from "../../../core/blocknote/services/blocknote.service";
import { WebSocketService } from "../../../core/websocket/services/websocket.service";
import { ChunkRepository } from "../../chunk/repositories/chunk.repository";
import { AppLoggingService } from "../../../core/logging/services/logging.service";
import { QueueId } from "../../../config/enums/queue.id";
import { AiStatus } from "../../../common/enums/ai.status";
import { howToMeta } from "../entities/how-to.meta";

const chunkDocument = (pageContent: string) => ({ pageContent, metadata: {} }) as any;

describe("HowToService", () => {
  let service: HowToService;
  let repository: any;
  let jsonApiService: any;
  let chunkService: any;
  let chunkerService: any;
  let chunkQueue: any;

  beforeEach(async () => {
    repository = {
      findPublished: vi.fn(),
      findPublishedByTypeAndSlug: vi.fn(),
      findRelated: vi.fn(),
      addRelated: vi.fn(),
      removeRelated: vi.fn(),
      findAllHowTos: vi.fn(),
      updateStatus: vi.fn(),
    };
    chunkService = { deleteChunks: vi.fn(), createChunks: vi.fn().mockResolvedValue([]) };
    chunkerService = { generateContentStructureFromMarkdown: vi.fn().mockResolvedValue([]) };
    chunkQueue = { add: vi.fn() };
    jsonApiService = {
      buildList: vi.fn().mockReturnValue({ data: [] }),
      buildSingle: vi.fn().mockReturnValue({ data: {} }),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        HowToService,
        { provide: HowToRepository, useValue: repository },
        { provide: JsonApiService, useValue: jsonApiService },
        { provide: ClsService, useValue: { get: vi.fn() } },
        { provide: ChunkService, useValue: chunkService },
        { provide: ChunkerService, useValue: chunkerService },
        { provide: BlockNoteService, useValue: { convertToMarkdown: vi.fn().mockReturnValue("md") } },
        { provide: WebSocketService, useValue: { sendMessageToUser: vi.fn() } },
        { provide: ChunkRepository, useValue: { findChunkByContentIdAndType: vi.fn().mockResolvedValue([]) } },
        { provide: AppLoggingService, useValue: { log: vi.fn(), warn: vi.fn(), error: vi.fn() } },
        { provide: getQueueToken(QueueId.CHUNK), useValue: chunkQueue },
        {
          provide: ConfigService,
          useValue: { get: vi.fn().mockReturnValue({ process: { chunk: "process_chunk" }, notifications: {} }) },
        },
      ],
    }).compile();

    service = module.get<HowToService>(HowToService);
  });

  afterEach(() => vi.clearAllMocks());

  it("findPublishedList delegates to repository and builds a list", async () => {
    repository.findPublished.mockResolvedValue([{ id: "1" }]);
    const res = await service.findPublishedList({ query: {}, howToType: "tutorial" });
    expect(repository.findPublished).toHaveBeenCalledWith({ howToType: "tutorial" });
    expect(jsonApiService.buildList).toHaveBeenCalled();
    expect(res).toEqual({ data: [] });
  });

  it("findPublishedArticle throws NotFound when missing", async () => {
    repository.findPublishedByTypeAndSlug.mockResolvedValue(null);
    await expect(service.findPublishedArticle({ howToType: "how-to", slug: "nope" })).rejects.toThrow();
  });

  it("findPublishedArticle builds a single when found", async () => {
    repository.findPublishedByTypeAndSlug.mockResolvedValue({ id: "1" });
    const res = await service.findPublishedArticle({ howToType: "how-to", slug: "x" });
    expect(jsonApiService.buildSingle).toHaveBeenCalled();
    expect(res).toEqual({ data: {} });
  });

  it("findRelatedList resolves the article then its related", async () => {
    repository.findPublishedByTypeAndSlug.mockResolvedValue({ id: "1" });
    repository.findRelated.mockResolvedValue([{ id: "2" }]);
    await service.findRelatedList({ howToType: "how-to", slug: "x", query: {} });
    expect(repository.findRelated).toHaveBeenCalledWith({ howToId: "1" });
    expect(jsonApiService.buildList).toHaveBeenCalled();
  });

  describe("queueHowToForProcessing", () => {
    const description = '[{"type":"paragraph"}]';
    const statuses = () => repository.updateStatus.mock.calls.map((call: any[]) => call[0].aiStatus);

    it("enqueues one job per chunk for a guide with content", async () => {
      chunkerService.generateContentStructureFromMarkdown.mockResolvedValue([
        chunkDocument("first"),
        chunkDocument("second"),
      ]);
      chunkService.createChunks.mockResolvedValue([{ id: "c1" }, { id: "c2" }]);

      await service.queueHowToForProcessing({ howToId: "h1", description });

      expect(chunkService.deleteChunks).toHaveBeenCalledWith({ id: "h1", nodeType: howToMeta.labelName });
      expect(chunkService.createChunks).toHaveBeenCalledWith({
        id: "h1",
        nodeType: howToMeta.labelName,
        data: [chunkDocument("first"), chunkDocument("second")],
      });
      expect(chunkQueue.add).toHaveBeenCalledTimes(2);
      expect(chunkQueue.add).toHaveBeenCalledWith(
        "process_chunk",
        expect.objectContaining({ chunkId: "c1", contentId: "h1", contentType: howToMeta.labelName }),
      );
      expect(statuses()).toEqual([AiStatus.InProgress, AiStatus.InProgress]);
    });

    it("drops blank chunk documents before creating chunks", async () => {
      chunkerService.generateContentStructureFromMarkdown.mockResolvedValue([
        chunkDocument("   "),
        chunkDocument("kept"),
        chunkDocument(""),
      ]);
      chunkService.createChunks.mockResolvedValue([{ id: "c1" }]);

      await service.queueHowToForProcessing({ howToId: "h1", description });

      expect(chunkService.createChunks).toHaveBeenCalledWith(
        expect.objectContaining({ data: [chunkDocument("kept")] }),
      );
      expect(chunkQueue.add).toHaveBeenCalledTimes(1);
    });

    it("settles a whitespace-only guide to completed and enqueues nothing", async () => {
      chunkerService.generateContentStructureFromMarkdown.mockResolvedValue([
        chunkDocument("   "),
        chunkDocument("\n\t"),
      ]);

      await service.queueHowToForProcessing({ howToId: "h1", description });

      expect(chunkService.createChunks).not.toHaveBeenCalled();
      expect(chunkQueue.add).not.toHaveBeenCalled();
      expect(statuses()).toEqual([AiStatus.InProgress, AiStatus.Completed]);
      expect(repository.updateStatus).toHaveBeenLastCalledWith({ id: "h1", aiStatus: AiStatus.Completed });
    });

    it("settles a guide to completed when the chunker returns nothing at all", async () => {
      chunkerService.generateContentStructureFromMarkdown.mockResolvedValue([]);

      await service.queueHowToForProcessing({ howToId: "h1", description });

      expect(chunkService.createChunks).not.toHaveBeenCalled();
      expect(statuses()).toEqual([AiStatus.InProgress, AiStatus.Completed]);
    });

    it("settles to failed and rethrows when the pipeline throws mid-way", async () => {
      const boom = new Error("azure 400");
      chunkerService.generateContentStructureFromMarkdown.mockResolvedValue([chunkDocument("body")]);
      chunkService.createChunks.mockRejectedValue(boom);

      await expect(service.queueHowToForProcessing({ howToId: "h1", description })).rejects.toThrow(boom);

      expect(chunkQueue.add).not.toHaveBeenCalled();
      expect(statuses()).toEqual([AiStatus.InProgress, AiStatus.Failed]);
      expect(repository.updateStatus).toHaveBeenLastCalledWith({ id: "h1", aiStatus: AiStatus.Failed });
    });

    it("settles to failed when enqueueing itself throws", async () => {
      chunkerService.generateContentStructureFromMarkdown.mockResolvedValue([chunkDocument("body")]);
      chunkService.createChunks.mockResolvedValue([{ id: "c1" }]);
      chunkQueue.add.mockRejectedValue(new Error("redis down"));

      await expect(service.queueHowToForProcessing({ howToId: "h1", description })).rejects.toThrow("redis down");

      expect(statuses()).toEqual([AiStatus.InProgress, AiStatus.InProgress, AiStatus.Failed]);
    });
  });

  it("reindexAll skips non-JSON descriptions without throwing", async () => {
    repository.findAllHowTos.mockResolvedValue([
      { id: "1", description: '[{"type":"paragraph"}]' },
      { id: "2", description: "plain text summary" },
    ]);
    await expect(service.reindexAll()).resolves.toBeUndefined();
    expect(repository.findAllHowTos).toHaveBeenCalled();
  });
});
