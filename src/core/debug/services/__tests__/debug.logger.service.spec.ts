import { vi, describe, it, expect, beforeEach, afterEach } from "vitest";
import { Test, TestingModule } from "@nestjs/testing";
import * as fs from "fs";
import * as path from "path";

// Mock fs module
vi.mock("fs", () => ({
  existsSync: vi.fn(),
  mkdirSync: vi.fn(),
  writeFileSync: vi.fn(),
  readFileSync: vi.fn(),
}));

// Store original env
const originalEnv = { ...process.env };

import { DebugLoggerService } from "../debug.logger.service";

describe("DebugLoggerService", () => {
  let service: DebugLoggerService;

  const mockRoundContext = {
    roundId: "round-123",
    roundPosition: 1,
    gameId: "game-456",
    gameType: "trivia",
    characters: [{ id: "char-1", name: "Alice", traitsSummary: "smart" }],
    player: { id: "player-1", name: "Bob" },
  };

  const mockCharacter = { id: "char-1", name: "Alice" };

  beforeEach(async () => {
    vi.clearAllMocks();

    // Reset environment
    process.env = { ...originalEnv };
    process.env.DEBUG_LOGGING_ENABLED = "true";
    process.env.DEBUG_LOG_PATH = "./test-logs";

    // Mock fs functions
    vi.mocked(fs.existsSync).mockReturnValue(true);
    vi.mocked(fs.mkdirSync).mockReturnValue(undefined);
    vi.mocked(fs.writeFileSync).mockReturnValue(undefined);

    const module: TestingModule = await Test.createTestingModule({
      providers: [DebugLoggerService],
    }).compile();

    service = module.get<DebugLoggerService>(DebugLoggerService);
  });

  afterEach(() => {
    vi.clearAllMocks();
    process.env = { ...originalEnv };
  });

  describe("isEnabled", () => {
    it("should return true when DEBUG_LOGGING_ENABLED is true", () => {
      expect(service.isEnabled()).toBe(true);
    });

    it("should return false when DEBUG_LOGGING_ENABLED is not true", async () => {
      process.env.DEBUG_LOGGING_ENABLED = "false";

      const module: TestingModule = await Test.createTestingModule({
        providers: [DebugLoggerService],
      }).compile();

      const disabledService = module.get<DebugLoggerService>(DebugLoggerService);
      expect(disabledService.isEnabled()).toBe(false);
    });
  });

  describe("startRound", () => {
    it("should initialize a round when enabled", () => {
      service.startRound(mockRoundContext);

      expect(service.getCurrentRoundPosition()).toBe(1);
    });

    it("should not initialize a round when disabled", async () => {
      process.env.DEBUG_LOGGING_ENABLED = "false";

      const module: TestingModule = await Test.createTestingModule({
        providers: [DebugLoggerService],
      }).compile();

      const disabledService = module.get<DebugLoggerService>(DebugLoggerService);
      disabledService.startRound(mockRoundContext);

      expect(disabledService.getCurrentRoundPosition()).toBeNull();
    });
  });

  describe("startTurn", () => {
    it("should start a turn when round is active", () => {
      service.startRound(mockRoundContext);
      service.startTurn(1, mockCharacter);

      // Verify turn was started by finalizing it and checking it was added
      service.finalizeTurn();

      expect(fs.writeFileSync).toHaveBeenCalled();
      const writeCall = vi.mocked(fs.writeFileSync).mock.calls[0];
      const writtenData = JSON.parse(writeCall[1] as string);
      expect(writtenData.turns).toHaveLength(1);
      expect(writtenData.turns[0].turnNumber).toBe(1);
      expect(writtenData.turns[0].character).toEqual(mockCharacter);
    });

    it("should not start a turn when no round is active", () => {
      service.startTurn(1, mockCharacter);

      // Should not throw, just silently return
      expect(fs.writeFileSync).not.toHaveBeenCalled();
    });

    it("should not start a turn when disabled", async () => {
      process.env.DEBUG_LOGGING_ENABLED = "false";

      const module: TestingModule = await Test.createTestingModule({
        providers: [DebugLoggerService],
      }).compile();

      const disabledService = module.get<DebugLoggerService>(DebugLoggerService);
      disabledService.startTurn(1, mockCharacter);

      expect(fs.writeFileSync).not.toHaveBeenCalled();
    });
  });

  describe("logStage", () => {
    it("should log stage data within a turn", () => {
      service.startRound(mockRoundContext);
      service.startTurn(1, mockCharacter);
      service.logStage("analyze", { result: "success" });
      service.finalizeTurn();

      const writeCall = vi.mocked(fs.writeFileSync).mock.calls[0];
      const writtenData = JSON.parse(writeCall[1] as string);
      expect(writtenData.turns[0].stages.analyze).toBeDefined();
      expect(writtenData.turns[0].stages.analyze.result).toBe("success");
      expect(writtenData.turns[0].stages.analyze.timestamp).toBeDefined();
    });

    it("should not log when no turn is active", () => {
      service.startRound(mockRoundContext);
      service.logStage("analyze", { result: "success" });

      expect(fs.writeFileSync).not.toHaveBeenCalled();
    });
  });

  describe("logLLMCall", () => {
    it("should log LLM call data within a stage", () => {
      service.startRound(mockRoundContext);
      service.startTurn(1, mockCharacter);
      service.logLLMCall("analyze", { prompt: "test" }, { response: "output" }, { tokens: 100 });
      service.finalizeTurn();

      const writeCall = vi.mocked(fs.writeFileSync).mock.calls[0];
      const writtenData = JSON.parse(writeCall[1] as string);
      const stage = writtenData.turns[0].stages.analyze;
      expect(stage.llmCall).toBeDefined();
      expect(stage.llmCall.inputParams).toEqual({ prompt: "test" });
      expect(stage.llmCall.outputRaw).toEqual({ response: "output" });
      expect(stage.llmCall.metadata).toEqual({ tokens: 100 });
    });

    it("should merge with existing stage data", () => {
      service.startRound(mockRoundContext);
      service.startTurn(1, mockCharacter);
      service.logStage("analyze", { previousData: "exists" });
      service.logLLMCall("analyze", { prompt: "test" }, { response: "output" });
      service.finalizeTurn();

      const writeCall = vi.mocked(fs.writeFileSync).mock.calls[0];
      const writtenData = JSON.parse(writeCall[1] as string);
      const stage = writtenData.turns[0].stages.analyze;
      expect(stage.previousData).toBe("exists");
      expect(stage.llmCall).toBeDefined();
    });

    it("should not include metadata if not provided", () => {
      service.startRound(mockRoundContext);
      service.startTurn(1, mockCharacter);
      service.logLLMCall("analyze", { prompt: "test" }, { response: "output" });
      service.finalizeTurn();

      const writeCall = vi.mocked(fs.writeFileSync).mock.calls[0];
      const writtenData = JSON.parse(writeCall[1] as string);
      const stage = writtenData.turns[0].stages.analyze;
      expect(stage.llmCall.metadata).toBeUndefined();
    });
  });

  describe("logGMLLMCall", () => {
    it("should log GM LLM call at round level", () => {
      service.startRound(mockRoundContext);
      service.logGMLLMCall("setup", { prompt: "gm prompt" }, { response: "gm output" });

      expect(fs.writeFileSync).toHaveBeenCalled();
      const writeCall = vi.mocked(fs.writeFileSync).mock.calls[0];
      const writtenData = JSON.parse(writeCall[1] as string);
      expect(writtenData.gmStages).toBeDefined();
      expect(writtenData.gmStages.setup).toBeDefined();
      expect(writtenData.gmStages.setup.llmCall.inputParams).toEqual({ prompt: "gm prompt" });
    });

    it("should not require a turn to be active", () => {
      service.startRound(mockRoundContext);
      // No startTurn called
      service.logGMLLMCall("setup", { prompt: "gm prompt" }, { response: "gm output" });

      expect(fs.writeFileSync).toHaveBeenCalled();
    });

    it("should write immediately for persistence", () => {
      service.startRound(mockRoundContext);
      service.logGMLLMCall("setup", { prompt: "test" }, { response: "output" });

      // Should have written immediately, not waiting for finalize
      expect(fs.writeFileSync).toHaveBeenCalledTimes(1);
    });
  });

  describe("logValidation", () => {
    it("should log validation issues within a stage", () => {
      const issues = [{ field: "name", message: "required" }];
      service.startRound(mockRoundContext);
      service.startTurn(1, mockCharacter);
      service.logValidation("validate", issues);
      service.finalizeTurn();

      const writeCall = vi.mocked(fs.writeFileSync).mock.calls[0];
      const writtenData = JSON.parse(writeCall[1] as string);
      const stage = writtenData.turns[0].stages.validate;
      expect(stage.validation).toBeDefined();
      expect(stage.validation.issues).toEqual(issues);
      expect(stage.validation.issueCount).toBe(1);
    });
  });

  describe("finalizeTurn", () => {
    it("should add turn to round and write log", () => {
      service.startRound(mockRoundContext);
      service.startTurn(1, mockCharacter);
      service.finalizeTurn();

      expect(fs.writeFileSync).toHaveBeenCalled();
    });

    it("should clear current turn after finalize", () => {
      service.startRound(mockRoundContext);
      service.startTurn(1, mockCharacter);
      service.finalizeTurn();

      // Starting another turn should work
      service.startTurn(2, { id: "char-2", name: "Bob" });
      service.finalizeTurn();

      const writeCall = vi.mocked(fs.writeFileSync).mock.calls[1];
      const writtenData = JSON.parse(writeCall[1] as string);
      expect(writtenData.turns).toHaveLength(2);
    });

    it("should create directory if it does not exist", () => {
      vi.mocked(fs.existsSync).mockReturnValue(false);

      service.startRound(mockRoundContext);
      service.startTurn(1, mockCharacter);
      service.finalizeTurn();

      expect(fs.mkdirSync).toHaveBeenCalledWith(expect.stringContaining("game-456"), { recursive: true });
    });
  });

  describe("finalizeRound", () => {
    it("should write final log and clear state", async () => {
      service.startRound(mockRoundContext);
      service.startTurn(1, mockCharacter);
      service.finalizeTurn();

      await service.finalizeRound();

      expect(service.getCurrentRoundPosition()).toBeNull();
    });

    it("should not throw when called without active round", async () => {
      await expect(service.finalizeRound()).resolves.not.toThrow();
    });
  });

  describe("getCurrentRoundPosition", () => {
    it("should return null when no round is active", () => {
      expect(service.getCurrentRoundPosition()).toBeNull();
    });

    it("should return round position when round is active", () => {
      service.startRound(mockRoundContext);
      expect(service.getCurrentRoundPosition()).toBe(1);
    });
  });

  describe("appendToStage", () => {
    it("should append data to existing stage", () => {
      service.startRound(mockRoundContext);
      service.startTurn(1, mockCharacter);
      service.logStage("analyze", { initial: "data" });
      service.appendToStage("analyze", "appended", "value");
      service.finalizeTurn();

      const writeCall = vi.mocked(fs.writeFileSync).mock.calls[0];
      const writtenData = JSON.parse(writeCall[1] as string);
      const stage = writtenData.turns[0].stages.analyze;
      expect(stage.initial).toBe("data");
      expect(stage.appended).toBe("value");
    });

    it("should create stage if it does not exist", () => {
      service.startRound(mockRoundContext);
      service.startTurn(1, mockCharacter);
      service.appendToStage("newStage", "key", "value");
      service.finalizeTurn();

      const writeCall = vi.mocked(fs.writeFileSync).mock.calls[0];
      const writtenData = JSON.parse(writeCall[1] as string);
      expect(writtenData.turns[0].stages.newStage.key).toBe("value");
    });
  });

  describe("appendToStageAsync", () => {
    it("should read existing log, append data, and write back", async () => {
      const existingLog = {
        roundId: "round-123",
        roundPosition: 1,
        gameId: "game-456",
        startedAt: "2024-01-01T00:00:00.000Z",
        gameContext: mockRoundContext,
        turns: [
          {
            turnNumber: 1,
            character: mockCharacter,
            timestamp: "2024-01-01T00:00:00.000Z",
            stages: { existing: { data: "value" } },
          },
        ],
      };

      vi.mocked(fs.readFileSync).mockReturnValue(JSON.stringify(existingLog));

      await service.appendToStageAsync({
        gameId: "game-456",
        roundPosition: 1,
        turnNumber: 1,
        characterId: "char-1",
        stageName: "existing",
        key: "appended",
        data: "newValue",
      });

      expect(fs.writeFileSync).toHaveBeenCalled();
      const writeCall = vi.mocked(fs.writeFileSync).mock.calls[0];
      const writtenData = JSON.parse(writeCall[1] as string);
      expect(writtenData.turns[0].stages.existing.data).toBe("value");
      expect(writtenData.turns[0].stages.existing.appended).toBe("newValue");
    });

    it("should warn and return when turn not found", async () => {
      const consoleWarnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
      const existingLog = {
        roundId: "round-123",
        roundPosition: 1,
        gameId: "game-456",
        startedAt: "2024-01-01T00:00:00.000Z",
        gameContext: mockRoundContext,
        turns: [],
      };

      vi.mocked(fs.readFileSync).mockReturnValue(JSON.stringify(existingLog));

      await service.appendToStageAsync({
        gameId: "game-456",
        roundPosition: 1,
        turnNumber: 1,
        characterId: "char-1",
        stageName: "stage",
        key: "key",
        data: "value",
      });

      expect(consoleWarnSpy).toHaveBeenCalledWith(expect.stringContaining("Turn not found"));
      consoleWarnSpy.mockRestore();
    });

    it("should handle file not found", async () => {
      const consoleWarnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
      vi.mocked(fs.existsSync).mockReturnValue(false);

      await service.appendToStageAsync({
        gameId: "game-456",
        roundPosition: 1,
        turnNumber: 1,
        characterId: "char-1",
        stageName: "stage",
        key: "key",
        data: "value",
      });

      expect(consoleWarnSpy).toHaveBeenCalledWith(expect.stringContaining("Round log file not found"));
      consoleWarnSpy.mockRestore();
    });

    it("should not execute when disabled", async () => {
      process.env.DEBUG_LOGGING_ENABLED = "false";

      const module: TestingModule = await Test.createTestingModule({
        providers: [DebugLoggerService],
      }).compile();

      const disabledService = module.get<DebugLoggerService>(DebugLoggerService);

      await disabledService.appendToStageAsync({
        gameId: "game-456",
        roundPosition: 1,
        turnNumber: 1,
        characterId: "char-1",
        stageName: "stage",
        key: "key",
        data: "value",
      });

      expect(fs.readFileSync).not.toHaveBeenCalled();
    });
  });

  describe("logLLMCallAsync", () => {
    it("should read existing log, add LLM call, and write back", async () => {
      const existingLog = {
        roundId: "round-123",
        roundPosition: 1,
        gameId: "game-456",
        startedAt: "2024-01-01T00:00:00.000Z",
        gameContext: mockRoundContext,
        turns: [
          {
            turnNumber: 1,
            character: mockCharacter,
            timestamp: "2024-01-01T00:00:00.000Z",
            stages: {},
          },
        ],
      };

      vi.mocked(fs.readFileSync).mockReturnValue(JSON.stringify(existingLog));

      await service.logLLMCallAsync({
        gameId: "game-456",
        roundPosition: 1,
        turnNumber: 1,
        characterId: "char-1",
        stageName: "analyze",
        input: { prompt: "test" },
        output: { response: "output" },
        metadata: { tokens: 50 },
      });

      expect(fs.writeFileSync).toHaveBeenCalled();
      const writeCall = vi.mocked(fs.writeFileSync).mock.calls[0];
      const writtenData = JSON.parse(writeCall[1] as string);
      expect(writtenData.turns[0].stages.analyze.llmCall).toBeDefined();
      expect(writtenData.turns[0].stages.analyze.llmCall.inputParams).toEqual({ prompt: "test" });
      expect(writtenData.turns[0].stages.analyze.llmCall.outputRaw).toEqual({ response: "output" });
      expect(writtenData.turns[0].stages.analyze.llmCall.metadata).toEqual({ tokens: 50 });
    });

    it("should warn when turn not found", async () => {
      const consoleWarnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
      const existingLog = {
        roundId: "round-123",
        roundPosition: 1,
        gameId: "game-456",
        startedAt: "2024-01-01T00:00:00.000Z",
        gameContext: mockRoundContext,
        turns: [],
      };

      vi.mocked(fs.readFileSync).mockReturnValue(JSON.stringify(existingLog));

      await service.logLLMCallAsync({
        gameId: "game-456",
        roundPosition: 1,
        turnNumber: 1,
        characterId: "char-1",
        stageName: "analyze",
        input: {},
        output: {},
      });

      expect(consoleWarnSpy).toHaveBeenCalledWith(expect.stringContaining("Turn not found for async LLM log"));
      consoleWarnSpy.mockRestore();
    });

    it("should not include metadata if not provided", async () => {
      const existingLog = {
        roundId: "round-123",
        roundPosition: 1,
        gameId: "game-456",
        startedAt: "2024-01-01T00:00:00.000Z",
        gameContext: mockRoundContext,
        turns: [
          {
            turnNumber: 1,
            character: mockCharacter,
            timestamp: "2024-01-01T00:00:00.000Z",
            stages: {},
          },
        ],
      };

      vi.mocked(fs.readFileSync).mockReturnValue(JSON.stringify(existingLog));

      await service.logLLMCallAsync({
        gameId: "game-456",
        roundPosition: 1,
        turnNumber: 1,
        characterId: "char-1",
        stageName: "analyze",
        input: { prompt: "test" },
        output: { response: "output" },
      });

      const writeCall = vi.mocked(fs.writeFileSync).mock.calls[0];
      const writtenData = JSON.parse(writeCall[1] as string);
      expect(writtenData.turns[0].stages.analyze.llmCall.metadata).toBeUndefined();
    });
  });

  describe("error handling", () => {
    it("should handle write errors gracefully", () => {
      const consoleErrorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
      vi.mocked(fs.writeFileSync).mockImplementation(() => {
        throw new Error("Write failed");
      });

      service.startRound(mockRoundContext);
      service.startTurn(1, mockCharacter);
      service.finalizeTurn();

      expect(consoleErrorSpy).toHaveBeenCalledWith(expect.stringContaining("ERROR writing log"), "Write failed");
      consoleErrorSpy.mockRestore();
    });

    it("should handle read errors gracefully in async methods", async () => {
      const consoleErrorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
      vi.mocked(fs.readFileSync).mockImplementation(() => {
        throw new Error("Read failed");
      });

      await service.appendToStageAsync({
        gameId: "game-456",
        roundPosition: 1,
        turnNumber: 1,
        characterId: "char-1",
        stageName: "stage",
        key: "key",
        data: "value",
      });

      expect(consoleErrorSpy).toHaveBeenCalledWith(
        expect.stringContaining("ERROR reading round log"),
        expect.any(String),
      );
      consoleErrorSpy.mockRestore();
    });
  });

  describe("file path generation", () => {
    it("should use correct file path pattern", () => {
      service.startRound(mockRoundContext);
      service.startTurn(1, mockCharacter);
      service.finalizeTurn();

      const writeCall = vi.mocked(fs.writeFileSync).mock.calls[0];
      const filepath = writeCall[0] as string;
      expect(filepath).toContain("game-456");
      expect(filepath).toContain("round-1.log");
    });

    it("should use default log path when not configured", async () => {
      delete process.env.DEBUG_LOG_PATH;

      const module: TestingModule = await Test.createTestingModule({
        providers: [DebugLoggerService],
      }).compile();

      const defaultPathService = module.get<DebugLoggerService>(DebugLoggerService);
      defaultPathService.startRound(mockRoundContext);
      defaultPathService.startTurn(1, mockCharacter);
      defaultPathService.finalizeTurn();

      const writeCall = vi.mocked(fs.writeFileSync).mock.calls[0];
      const filepath = writeCall[0] as string;
      expect(filepath).toContain(path.join(".", "logs"));
    });
  });
});
