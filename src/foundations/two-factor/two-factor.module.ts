import { forwardRef, Module, OnModuleInit } from "@nestjs/common";
import { modelRegistry } from "../../common/registries/registry";
import { JsonApiModule } from "../../core/jsonapi/jsonapi.module";
import { AuthModule } from "../auth/auth.module";
import { UserModule } from "../user/user.module";

// Controllers
import { PasskeyController } from "./controllers/passkey.controller";
import { TotpController } from "./controllers/totp.controller";
import { TwoFactorController } from "./controllers/two-factor.controller";

// Entity Descriptors (models for registration)
import { BackupCodeDescriptor } from "./entities/backup-code";
import { BackupCodesCountDescriptor } from "./entities/backup-codes-count";
import { BackupCodesGenerationDescriptor } from "./entities/backup-codes-generation";
import { PasskeyDescriptor } from "./entities/passkey";
import { PasskeyAuthenticationOptionsDescriptor } from "./entities/passkey-authentication-options";
import { PasskeyRegistrationOptionsDescriptor } from "./entities/passkey-registration-options";
import { PendingTwoFactorDescriptor } from "./entities/pending-two-factor";
import { TotpAuthenticatorDescriptor } from "./entities/totp-authenticator";
import { TotpSetupDescriptor } from "./entities/totp-setup";
import { TwoFactorChallengeDescriptor } from "./entities/two-factor-challenge";
import { TwoFactorConfigDescriptor } from "./entities/two-factor-config";
import { TwoFactorStatusDescriptor } from "./entities/two-factor-status";
import { TwoFactorVerificationDescriptor } from "./entities/two-factor-verification";

// Repositories
import { BackupCodeRepository } from "./repositories/backup-code.repository";
import { PasskeyRepository } from "./repositories/passkey.repository";
import { PendingTwoFactorRepository } from "./repositories/pending-two-factor.repository";
import { TotpAuthenticatorRepository } from "./repositories/totp-authenticator.repository";
import { TwoFactorConfigRepository } from "./repositories/two-factor-config.repository";

// Services
import { BackupCodeService } from "./services/backup-code.service";
import { PasskeyService } from "./services/passkey.service";
import { TotpEncryptionService } from "./services/totp-encryption.service";
import { TotpService } from "./services/totp.service";
import { TwoFactorService } from "./services/two-factor.service";

// Guards
import { PendingAuthGuard } from "./guards/pending-auth.guard";

/**
 * TwoFactorModule - Two-Factor Authentication Module
 *
 * Provides comprehensive 2FA functionality including:
 * - TOTP (Time-based One-Time Password) authentication
 * - Passkey/WebAuthn authentication
 * - Backup codes for account recovery
 * - Pending session management for 2FA login flow
 *
 * @example
 * ```typescript
 * // Import in AuthModule
 * @Module({
 *   imports: [TwoFactorModule],
 * })
 * export class AuthModule {}
 * ```
 */
@Module({
  imports: [JsonApiModule, UserModule, forwardRef(() => AuthModule)],
  controllers: [PasskeyController, TotpController, TwoFactorController],
  providers: [
    // Serializers from descriptors
    BackupCodeDescriptor.model.serialiser,
    BackupCodesCountDescriptor.model.serialiser,
    BackupCodesGenerationDescriptor.model.serialiser,
    PasskeyDescriptor.model.serialiser,
    PasskeyAuthenticationOptionsDescriptor.model.serialiser,
    PasskeyRegistrationOptionsDescriptor.model.serialiser,
    PendingTwoFactorDescriptor.model.serialiser,
    TotpAuthenticatorDescriptor.model.serialiser,
    TotpSetupDescriptor.model.serialiser,
    TwoFactorChallengeDescriptor.model.serialiser,
    TwoFactorConfigDescriptor.model.serialiser,
    TwoFactorStatusDescriptor.model.serialiser,
    TwoFactorVerificationDescriptor.model.serialiser,

    // Repositories
    BackupCodeRepository,
    PasskeyRepository,
    PendingTwoFactorRepository,
    TotpAuthenticatorRepository,
    TwoFactorConfigRepository,

    // Services
    BackupCodeService,
    PasskeyService,
    TotpEncryptionService,
    TotpService,
    TwoFactorService,

    // Guards
    PendingAuthGuard,
  ],
  exports: [
    // Export services for use by other modules (e.g., AuthModule)
    TwoFactorService,
    TotpService,
    PasskeyService,
    BackupCodeService,
    TotpEncryptionService,
    PendingAuthGuard,

    // Export repositories for advanced use cases
    TwoFactorConfigRepository,
    PendingTwoFactorRepository,
  ],
})
export class TwoFactorModule implements OnModuleInit {
  onModuleInit() {
    // Register all 2FA models with the global model registry
    modelRegistry.register(BackupCodeDescriptor.model);
    modelRegistry.register(BackupCodesCountDescriptor.model);
    modelRegistry.register(BackupCodesGenerationDescriptor.model);
    modelRegistry.register(PasskeyDescriptor.model);
    modelRegistry.register(PasskeyAuthenticationOptionsDescriptor.model);
    modelRegistry.register(PasskeyRegistrationOptionsDescriptor.model);
    modelRegistry.register(PendingTwoFactorDescriptor.model);
    modelRegistry.register(TotpAuthenticatorDescriptor.model);
    modelRegistry.register(TotpSetupDescriptor.model);
    modelRegistry.register(TwoFactorChallengeDescriptor.model);
    modelRegistry.register(TwoFactorConfigDescriptor.model);
    modelRegistry.register(TwoFactorStatusDescriptor.model);
    modelRegistry.register(TwoFactorVerificationDescriptor.model);
  }
}
