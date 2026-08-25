import { Module } from "@nestjs/common";
import { S3Service } from "./services/s3.service";

/**
 * S3 Service Module
 *
 * Provides S3Service and NOTHING else — no controller, no serialiser.
 *
 * WHY THIS EXISTS: S3Service used to be registered TWICE — once by S3Module,
 * and once directly in MigratorModule's `providers` (so the migrator could
 * upload without re-registering S3Module's GET /s3 controller). Two
 * registrations mean two InstanceWrappers for one class token, and
 * `ModuleRef.get(token, { strict: false })` — which the descriptor-based
 * serialiser uses to satisfy `injectServices` — returns the LAST link:
 *
 *   instanceLinksForGivenToken[instanceLinksForGivenToken.length - 1]
 *
 * so which instance you got depended on module registration order.
 *
 * NOT the cause of the 2026-08-25 `imageUrl` outage — that was the serialiser
 * resolving `injectServices` in its CONSTRUCTOR and capturing Nest's
 * placeholder instance; see resolveInjectedServices() in
 * core/jsonapi/serialisers/descriptor.based.serialiser.ts. This split was made
 * while investigating it and kept on its own merit: a single registration
 * removes the order dependence from every `strict: false` lookup of S3Service,
 * so the two hazards cannot compound.
 *
 * Import THIS module wherever S3Service is needed without the /s3 controller;
 * import S3Module when the controller is wanted too.
 */
@Module({
  providers: [S3Service],
  exports: [S3Service],
})
export class S3ServiceModule {}
