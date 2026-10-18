import { BadRequestException, Injectable } from "@nestjs/common";
import * as bcrypt from "bcrypt";
import * as crypto from "crypto";
import { JsonApiService } from "../../../core/jsonapi/services/jsonapi.service";
import { BackupCodesCountDescriptor } from "../entities/backup-codes-count";
import { BackupCodesGenerationDescriptor } from "../entities/backup-codes-generation";
import { BackupCodeRepository } from "../repositories/backup-code.repository";
import { JsonApiSingleDocument } from "../../../core/jsonapi/interfaces/jsonapi.document.interface";

const BACKUP_CODE_COUNT = 10;
const BACKUP_CODE_LENGTH = 8; // 8 hex characters
const BCRYPT_ROUNDS = 10;

export interface BackupCodeGenerationResult {
  codes: string[];
  count: number;
}

/**
 * Backup Code Service
 *
 * Manages single-use backup codes for two-factor authentication recovery.
 * Codes are 8 hex characters, bcrypt hashed, and can only be used once.
 */
@Injectable()
export class BackupCodeService {
  constructor(
    private readonly jsonApiService: JsonApiService,
    private readonly backupCodeRepository: BackupCodeRepository,
  ) {}

  /**
   * Generate a batch of backup codes for a user.
   * Codes are returned in plain text ONCE - they should be shown to the user
   * and will never be retrievable again (only hashes are stored).
   *
   * @param params.userId - The user's ID
   * @returns JSON:API response with plain text backup codes (show to user once)
   */
  async generateCodes(params: { userId: string }): Promise<JsonApiSingleDocument> {
    // Check if user already has backup codes
    const existingCount = await this.backupCodeRepository.findUnusedCount({
      userId: params.userId,
    });

    if (existingCount > 0) {
      throw new BadRequestException("User already has backup codes. Use regenerateCodes to replace them.");
    }

    const result = await this.createBackupCodes({ userId: params.userId });

    return this.jsonApiService.buildSingle(BackupCodesGenerationDescriptor.model, {
      id: params.userId,
      codes: result.codes,
      count: result.count,
    });
  }

  /**
   * Validate a backup code for a user.
   * If valid, the code is marked as used and cannot be reused.
   *
   * @param params.userId - The user's ID
   * @param params.code - The backup code to validate (8 hex characters)
   * @returns true if the code was valid and has been consumed
   */
  async validateCode(params: { userId: string; code: string }): Promise<boolean> {
    // Normalize the code (uppercase, remove any dashes/spaces)
    const normalizedCode = params.code.toUpperCase().replace(/[-\s]/g, "");

    // Validate code format
    if (!/^[0-9A-F]{8}$/.test(normalizedCode)) {
      return false;
    }

    // Get all unused backup codes for the user
    const unusedCodes = await this.backupCodeRepository.findUnusedByUserId({
      userId: params.userId,
    });

    // Check each code hash
    for (const backupCode of unusedCodes) {
      const isMatch = await bcrypt.compare(normalizedCode, backupCode.codeHash);

      if (isMatch) {
        // Mark the code as used
        await this.backupCodeRepository.markUsed({ codeId: backupCode.id });
        return true;
      }
    }

    return false;
  }

  /**
   * Get the count of unused backup codes for a user.
   *
   * @param params.userId - The user's ID
   * @returns JSON:API response with unused backup codes count
   */
  async getUnusedCount(params: { userId: string }): Promise<JsonApiSingleDocument> {
    const count = await this.backupCodeRepository.findUnusedCount({ userId: params.userId });

    return this.jsonApiService.buildSingle(BackupCodesCountDescriptor.model, {
      id: params.userId,
      count,
    });
  }

  /**
   * Get the raw count of unused backup codes (for internal use).
   *
   * @param params.userId - The user's ID
   * @returns Number of unused backup codes
   */
  async getRawUnusedCount(params: { userId: string }): Promise<number> {
    return this.backupCodeRepository.findUnusedCount({ userId: params.userId });
  }

  /**
   * Regenerate backup codes for a user.
   * This deletes all existing codes (used and unused) and generates a new batch.
   *
   * @param params.userId - The user's ID
   * @returns JSON:API response with new plain text backup codes (show to user once)
   */
  async regenerateCodes(params: { userId: string }): Promise<JsonApiSingleDocument> {
    // Delete all existing backup codes
    await this.backupCodeRepository.deleteAllByUserId({ userId: params.userId });

    // Generate new codes
    const result = await this.createBackupCodes({ userId: params.userId });

    return this.jsonApiService.buildSingle(BackupCodesGenerationDescriptor.model, {
      id: params.userId,
      codes: result.codes,
      count: result.count,
    });
  }

  /**
   * Check if a user has any backup codes (used or unused).
   *
   * @param params.userId - The user's ID
   * @returns true if the user has any backup codes
   */
  async hasBackupCodes(params: { userId: string }): Promise<boolean> {
    const codes = await this.backupCodeRepository.findByUserId({
      userId: params.userId,
    });
    return codes.length > 0;
  }

  /**
   * Delete all backup codes for a user.
   *
   * @param params.userId - The user's ID
   */
  async deleteAllCodes(params: { userId: string }): Promise<void> {
    await this.backupCodeRepository.deleteAllByUserId({ userId: params.userId });
  }

  /**
   * Generate a single random backup code.
   * Format: 8 uppercase hex characters (e.g., "A1B2C3D4")
   */
  private generateSingleCode(): string {
    const bytes = crypto.randomBytes(BACKUP_CODE_LENGTH / 2); // 4 bytes = 8 hex chars
    return bytes.toString("hex").toUpperCase();
  }

  /**
   * Create backup codes in the database and return plain text codes.
   */
  private async createBackupCodes(params: { userId: string }): Promise<BackupCodeGenerationResult> {
    const plainCodes: string[] = [];

    for (let i = 0; i < BACKUP_CODE_COUNT; i++) {
      const plainCode = this.generateSingleCode();
      const codeHash = await bcrypt.hash(plainCode, BCRYPT_ROUNDS);
      const codeId = crypto.randomUUID();

      await this.backupCodeRepository.createForUser({
        codeId,
        userId: params.userId,
        codeHash,
      });

      plainCodes.push(plainCode);
    }

    return {
      codes: plainCodes,
      count: plainCodes.length,
    };
  }
}
