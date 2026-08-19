import { Injectable } from "@nestjs/common";
import * as fs from "fs";
import * as path from "path";

import { baseConfig } from "../../../config/base.config";

interface RoundLogContext {
  roundId: string;
  roundPosition: number;
  gameId: string;
  gameType?: string;
  characters: Array<{ id: string; name: string; traitsSummary?: string }>;
  player: { id: string; name: string };
}

interface TurnLogEntry {
  turnNumber: number;
  character: { id: string; name: string };
  timestamp: string;
  stages: Record<string, any>;
}

interface GMStageEntry {
  timestamp: string;
  llmCall?: {
    timestamp: string;
    inputParams: any;
    outputRaw: any;
    metadata?: any;
  };
}

interface RoundLog {
  roundId: string;
  roundPosition: number;
  gameId: string;
  startedAt: string;
  gameContext: RoundLogContext;
  gmStages?: Record<string, GMStageEntry>;
  turns: TurnLogEntry[];
}

/**
 * Debug Logger Service
 *
 * Specialized logging service for debugging game rounds and LLM calls
 *
 * Features:
 * - Round-based logging structure
 * - Turn-by-turn tracking
 * - LLM call logging with input/output
 * - Stage-based organization
 * - File-based persistence
 * - Async logging support for background jobs
 *
 * @example
 * ```typescript
 * // Start a round
 * debugLogger.startRound({ roundId: '123', roundPosition: 1, gameId: 'game-1', ... });
 *
 * // Log a turn
 * debugLogger.startTurn(1, { id: 'char-1', name: 'Alice' });
 * debugLogger.logLLMCall('analyze', inputData, outputData);
 * debugLogger.finalizeTurn();
 *
 * // Finalize the round
 * await debugLogger.finalizeRound();
 * ```
 */
@Injectable()
export class DebugLoggerService {
  private enabled: boolean;
  private logBasePath: string;
  private currentRound: RoundLog | null = null;
  private currentTurn: TurnLogEntry | null = null;

  constructor() {
    const debugConfig = baseConfig.logging.debug;
    this.enabled = debugConfig.enabled;
    this.logBasePath = debugConfig.basePath;
  }

  /**
   * Initialize a new round log
   */
  startRound(context: RoundLogContext): void {
    if (!this.enabled) return;

    this.currentRound = {
      roundId: context.roundId,
      roundPosition: context.roundPosition,
      gameId: context.gameId,
      startedAt: new Date().toISOString(),
      gameContext: context,
      turns: [],
    };
  }

  /**
   * Start logging a new turn within the current round
   */
  startTurn(turnNumber: number, character: { id: string; name: string }): void {
    if (!this.enabled || !this.currentRound) return;

    this.currentTurn = {
      turnNumber,
      character,
      timestamp: new Date().toISOString(),
      stages: {},
    };
  }

  /**
   * Log a stage within the current turn
   */
  logStage(stageName: string, data: any): void {
    if (!this.enabled || !this.currentTurn) return;

    this.currentTurn.stages[stageName] = {
      timestamp: new Date().toISOString(),
      ...data,
    };
  }

  /**
   * Log an LLM call within a stage
   */
  logLLMCall(stageName: string, input: any, output: any, metadata?: any): void {
    if (!this.enabled || !this.currentTurn) return;

    const existingStage = this.currentTurn.stages[stageName] || {};
    this.currentTurn.stages[stageName] = {
      ...existingStage,
      llmCall: {
        timestamp: new Date().toISOString(),
        inputParams: input,
        outputRaw: output,
        ...(metadata && { metadata }),
      },
    };
  }

  /**
   * Log a GM (Game Master) LLM call at the round level (no turn required).
   * Used for GM agent operations that happen before/outside character turns.
   */
  logGMLLMCall(stageName: string, input: any, output: any, metadata?: any): void {
    if (!this.enabled || !this.currentRound) return;

    if (!this.currentRound.gmStages) {
      this.currentRound.gmStages = {};
    }

    this.currentRound.gmStages[stageName] = {
      timestamp: new Date().toISOString(),
      llmCall: {
        timestamp: new Date().toISOString(),
        inputParams: input,
        outputRaw: output,
        ...(metadata && { metadata }),
      },
    };

    // Write immediately so GM logs are persisted even if round doesn't complete
    this.writeRoundLog();
  }

  /**
   * Log validation results within a stage
   */
  logValidation(stageName: string, issues: any[]): void {
    if (!this.enabled || !this.currentTurn) return;

    const existingStage = this.currentTurn.stages[stageName] || {};
    this.currentTurn.stages[stageName] = {
      ...existingStage,
      validation: {
        timestamp: new Date().toISOString(),
        issues,
        issueCount: issues.length,
      },
    };
  }

  /**
   * Finalize the current turn and add it to the round
   */
  finalizeTurn(): void {
    if (!this.enabled || !this.currentRound || !this.currentTurn) return;

    this.currentRound.turns.push(this.currentTurn);
    this.currentTurn = null;

    // Write the round log after each turn
    this.writeRoundLog();
  }

  /**
   * Write the current round log to file (without clearing state)
   */
  private writeRoundLog(): void {
    if (!this.enabled || !this.currentRound) return;

    try {
      const gameDir = path.join(this.logBasePath, this.currentRound.gameId);

      // Ensure directory exists
      if (!fs.existsSync(gameDir)) {
        fs.mkdirSync(gameDir, { recursive: true });
      }

      const filename = `round-${this.currentRound.roundPosition}.log`;
      const filepath = path.join(gameDir, filename);

      // Write log file with pretty printing
      fs.writeFileSync(filepath, JSON.stringify(this.currentRound, null, 2), "utf8");
    } catch (error: any) {
      console.error(`[DebugLogger] ERROR writing log:`, error.message);
    }
  }

  /**
   * Finalize the round and write to file (clears state)
   */
  async finalizeRound(): Promise<void> {
    if (!this.enabled || !this.currentRound) return;

    // Write one last time before clearing
    this.writeRoundLog();

    // Clear the round state
    this.currentRound = null;
  }

  /**
   * Get the current round position (for logging purposes)
   */
  getCurrentRoundPosition(): number | null {
    return this.currentRound?.roundPosition ?? null;
  }

  /**
   * Check if logging is enabled
   */
  isEnabled(): boolean {
    return this.enabled;
  }

  /**
   * Append data to an existing stage (useful for multi-part logging)
   */
  appendToStage(stageName: string, key: string, data: any): void {
    if (!this.enabled || !this.currentTurn) return;

    const existingStage = this.currentTurn.stages[stageName] || {};
    this.currentTurn.stages[stageName] = {
      ...existingStage,
      [key]: data,
    };
  }

  /**
   * Async version of appendToStage for background jobs.
   * Reads the existing log file, appends data to the specified turn/stage, and writes back.
   */
  async appendToStageAsync(params: {
    gameId: string;
    roundPosition: number;
    turnNumber: number;
    characterId: string;
    stageName: string;
    key: string;
    data: any;
  }): Promise<void> {
    if (!this.enabled) return;

    try {
      const roundLog = await this.readRoundLog(params.gameId, params.roundPosition);
      if (!roundLog) return;

      // Find the turn by turnNumber and characterId
      const turn = roundLog.turns.find(
        (t) => t.turnNumber === params.turnNumber && t.character.id === params.characterId,
      );

      if (!turn) {
        console.warn(
          `[DebugLogger] Turn not found for async append: turn=${params.turnNumber}, character=${params.characterId}`,
        );
        return;
      }

      // Append to the stage
      const existingStage = turn.stages[params.stageName] || {};
      turn.stages[params.stageName] = {
        ...existingStage,
        [params.key]: params.data,
      };

      // Write back
      await this.writeRoundLogAsync(roundLog);
    } catch (error: any) {
      console.error(`[DebugLogger] ERROR in appendToStageAsync:`, error.message);
    }
  }

  /**
   * Async version of logLLMCall for background jobs.
   * Reads the existing log file, logs the LLM call to the specified turn/stage, and writes back.
   */
  async logLLMCallAsync(params: {
    gameId: string;
    roundPosition: number;
    turnNumber: number;
    characterId: string;
    stageName: string;
    input: any;
    output: any;
    metadata?: any;
  }): Promise<void> {
    if (!this.enabled) return;

    try {
      const roundLog = await this.readRoundLog(params.gameId, params.roundPosition);
      if (!roundLog) return;

      // Find the turn by turnNumber and characterId
      const turn = roundLog.turns.find(
        (t) => t.turnNumber === params.turnNumber && t.character.id === params.characterId,
      );

      if (!turn) {
        console.warn(
          `[DebugLogger] Turn not found for async LLM log: turn=${params.turnNumber}, character=${params.characterId}`,
        );
        return;
      }

      // Log the LLM call
      const existingStage = turn.stages[params.stageName] || {};
      turn.stages[params.stageName] = {
        ...existingStage,
        llmCall: {
          timestamp: new Date().toISOString(),
          inputParams: params.input,
          outputRaw: params.output,
          ...(params.metadata && { metadata: params.metadata }),
        },
      };

      // Write back
      await this.writeRoundLogAsync(roundLog);
    } catch (error: any) {
      console.error(`[DebugLogger] ERROR in logLLMCallAsync:`, error.message);
    }
  }

  /**
   * Read an existing round log from file
   */
  private async readRoundLog(gameId: string, roundPosition: number): Promise<RoundLog | null> {
    try {
      const filepath = path.join(this.logBasePath, gameId, `round-${roundPosition}.log`);

      if (!fs.existsSync(filepath)) {
        console.warn(`[DebugLogger] Round log file not found: ${filepath}`);
        return null;
      }

      const content = fs.readFileSync(filepath, "utf8");
      return JSON.parse(content) as RoundLog;
    } catch (error: any) {
      console.error(`[DebugLogger] ERROR reading round log:`, error.message);
      return null;
    }
  }

  /**
   * Write a round log to file (async version)
   */
  private async writeRoundLogAsync(roundLog: RoundLog): Promise<void> {
    try {
      const gameDir = path.join(this.logBasePath, roundLog.gameId);

      if (!fs.existsSync(gameDir)) {
        fs.mkdirSync(gameDir, { recursive: true });
      }

      const filename = `round-${roundLog.roundPosition}.log`;
      const filepath = path.join(gameDir, filename);

      fs.writeFileSync(filepath, JSON.stringify(roundLog, null, 2), "utf8");
    } catch (error: any) {
      console.error(`[DebugLogger] ERROR writing log async:`, error.message);
    }
  }
}
