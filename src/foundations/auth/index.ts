export { AuthModule } from "./auth.module";
export { AuthCompanyController } from "./controllers/auth.company.controller";
export { AuthController } from "./controllers/auth.controller";
export { AuthDiscordConnectionController } from "./controllers/auth.discord-connection.controller";
export { AuthGoogleController } from "./controllers/auth.google.controller";
export {
  DiscordConnectConfirmationPostDataDTO,
  DiscordConnectConfirmationPostDTO,
} from "./dtos/discord-connect-confirmation.post.dto";
export {
  DiscordConnectIntentPostAttributesDTO,
  DiscordConnectIntentPostDataDTO,
  DiscordConnectIntentPostDTO,
} from "./dtos/discord-connect-intent.post.dto";
export { AuthPostForgotDTO } from "./dtos/auth.post.forgot.dto";
export { AuthPostLoginAttributesDTO, AuthPostLoginDataDTO, AuthPostLoginDTO } from "./dtos/auth.post.login.dto";
export {
  AuthPostRegisterAttributesDTO,
  AuthPostRegisterDataDTO,
  AuthPostRegisterDTO,
} from "./dtos/auth.post.register.dto";
export {
  AuthPostOAuthCompleteAttributesDTO,
  AuthPostOAuthCompleteDataDTO,
  AuthPostOAuthCompleteDTO,
} from "./dtos/auth.post.oauth-complete.dto";
export { AuthPostResetPasswordDTO } from "./dtos/auth.post.resetpassword.dto";
export { Auth, AuthDescriptor } from "./entities/auth";
export { AuthCode, AuthCodeDescriptor } from "./entities/auth.code";
export { authCodeMeta } from "./entities/auth.code.meta";
export { authMeta } from "./entities/auth.meta";
export { USER_ACTIVATED_EVENT } from "./events/auth.events";
export type { UserActivatedEvent } from "./events/auth.events";
export { PendingAuth, PendingAuthDescriptor } from "./entities/pending-auth";
export { PendingRegistrationResource, PendingRegistrationDescriptor } from "./entities/pending-registration.resource";
export { pendingRegistrationMeta } from "./entities/pending-registration.meta";
export { pendingAuthMeta } from "./entities/pending-auth.meta";
export { DiscordConnectionDescriptor } from "./entities/discord-connection";
export type { DiscordConnection } from "./entities/discord-connection";
export { discordConnectionMeta } from "./entities/discord-connection.meta";
export { DiscordConnectIntentDescriptor } from "./entities/discord-connect-intent";
export type { DiscordConnectIntent } from "./entities/discord-connect-intent";
export { discordConnectIntentMeta } from "./entities/discord-connect-intent.meta";
export { DiscordConnectConfirmationDescriptor } from "./entities/discord-connect-confirmation";
export type { DiscordConnectConfirmation, DiscordConnectResult } from "./entities/discord-connect-confirmation";
export { discordConnectConfirmationMeta } from "./entities/discord-connect-confirmation.meta";
export { DISCORD_CONNECT_POLICY } from "./interfaces/discord-connect-policy.interface";
export type { DiscordConnectPolicyInterface } from "./interfaces/discord-connect-policy.interface";
export { resolveDiscordConnectPolicy } from "./utils/resolve-discord-connect-policy";
export { sanitiseReturnPath } from "./utils/sanitise-return-path";
export { REGISTRATION_HOOK, RegistrationHookInterface } from "./interfaces/registration-hook.interface";
export { REGISTRATION_PASS } from "./interfaces/registration-pass.interface";
export type { RegistrationPassInterface, RegistrationPassVerdict } from "./interfaces/registration-pass.interface";
export { resolveRegistrationPass } from "./utils/resolve-registration-pass";
export { AuthRepository } from "./repositories/auth.repository";
export { DiscordConnectionRepository } from "./repositories/discord-connection.repository";
export { AuthGoogleService } from "./services/auth.google.service";
export { AuthService } from "./services/auth.service";
export { DiscordConnectIntentService } from "./services/discord-connect-intent.service";
export { DiscordConnectIntentStore } from "./services/discord-connect-intent.store";
export type { StoredDiscordConnectIntent } from "./services/discord-connect-intent.store";
export { DiscordConnectionService } from "./services/discord-connection.service";
export { PendingRegistrationService } from "./services/pending-registration.service";
export { TrialQueueService } from "./services/trial-queue.service";
