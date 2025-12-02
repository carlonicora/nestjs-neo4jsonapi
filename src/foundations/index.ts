/**
 * Foundation modules - domain-specific business logic modules
 */

// Centralized FoundationsModule - import all foundation modules with single forRoot()
export { FoundationsModule, FoundationsModuleOptions } from "./foundations.modules";

// Individual foundation modules with entities, metas, repositories, and services
export { AtomicFact, AtomicFactModule, AtomicFactRepository } from "./atomicfact";
export { Audit, auditMeta, auditModel, AuditModule, AuditRepository, AuditService } from "./audit";
export { AuthModule } from "./auth";
export { Chunk, ChunkModule, ChunkRepository } from "./chunk";
export { ChunkerModule } from "./chunker";
export { Company, companyMeta, CompanyModel, CompanyModule, CompanyRepository, CompanyService } from "./company";
export { ContentModule } from "./content";
export { FeatureModule } from "./feature";
export { KeyConcept, KeyConceptModule, KeyConceptRepository } from "./keyconcept";
export { ModuleEntity, moduleMeta, ModuleModel, ModuleModule, ModuleRepository } from "./module";
export { NotificationModule } from "./notification";
export { PushModule } from "./push";
export { RelevancyModule } from "./relevancy";
export { RoleModule } from "./role";
export { S3Module, S3Service } from "./s3";
export { TokenUsageModule } from "./tokenusage";
export {
  ownerMeta,
  User,
  UserDataDTO,
  UserDataListDTO,
  userMeta,
  UserModel,
  UserModule,
  UserRepository,
  UserService,
} from "./user";
