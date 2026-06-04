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

describe("HowToService", () => {
  let service: HowToService;
  let repository: any;
  let jsonApiService: any;

  beforeEach(async () => {
    repository = {
      findPublished: vi.fn(),
      findPublishedByTypeAndSlug: vi.fn(),
      findRelated: vi.fn(),
      addRelated: vi.fn(),
      removeRelated: vi.fn(),
      findAllHowTos: vi.fn(),
    };
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
        { provide: ChunkService, useValue: { deleteChunks: vi.fn(), createChunks: vi.fn().mockResolvedValue([]) } },
        { provide: ChunkerService, useValue: { generateContentStructureFromMarkdown: vi.fn().mockResolvedValue({}) } },
        { provide: BlockNoteService, useValue: { convertToMarkdown: vi.fn().mockReturnValue("md") } },
        { provide: WebSocketService, useValue: { sendMessageToUser: vi.fn() } },
        { provide: ChunkRepository, useValue: { findChunkByContentIdAndType: vi.fn().mockResolvedValue([]) } },
        { provide: AppLoggingService, useValue: { log: vi.fn(), warn: vi.fn(), error: vi.fn() } },
        { provide: getQueueToken(QueueId.CHUNK), useValue: { add: vi.fn() } },
        { provide: ConfigService, useValue: { get: vi.fn().mockReturnValue({ process: {}, notifications: {} }) } },
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

  it("reindexAll skips non-JSON descriptions without throwing", async () => {
    repository.findAllHowTos.mockResolvedValue([
      { id: "1", description: '[{"type":"paragraph"}]' },
      { id: "2", description: "plain text summary" },
    ]);
    await expect(service.reindexAll()).resolves.toBeUndefined();
    expect(repository.findAllHowTos).toHaveBeenCalled();
  });
});
