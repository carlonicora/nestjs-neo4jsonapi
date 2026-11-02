// Module
export * from "./email-automation.module";

// Config
export * from "./interfaces/email-automation.config.interface";

// Built-in triggers
export * from "./triggers/built-in.triggers";

// Entities + metas
export * from "./entities/email-automation";
export * from "./entities/email-automation.meta";
export * from "./entities/email-automation-step";
export * from "./entities/email-automation-step.meta";
export * from "./entities/email-automation-enrollment";
export * from "./entities/email-automation-enrollment.meta";
export * from "./entities/email-opt-out";
export * from "./entities/email-opt-out.meta";
export * from "./entities/email-automation-trigger";
export * from "./entities/email-automation-trigger.meta";
export * from "./entities/email-automation-candidate";
export * from "./entities/email-automation-candidate.meta";

// DTOs
export * from "./dtos/email-automation.dto";
export * from "./dtos/email-automation.post.dto";
export * from "./dtos/email-automation.patch.dto";
export * from "./dtos/email-automation-step.dto";
export * from "./dtos/email-automation-step.post.dto";
export * from "./dtos/email-automation-step.patch.dto";
export * from "./dtos/email-automation-unsubscribe.dto";
export * from "./dtos/email-automation-enrollment.post.dto";

// Repositories
export * from "./repositories/email-automation.repository";
export * from "./repositories/email-automation-step.repository";
export * from "./repositories/email-automation-enrollment.repository";
export * from "./repositories/email-opt-out.repository";
export * from "./repositories/email-automation-candidate.repository";

// Services
export * from "./services/email-automation.service";
export * from "./services/email-automation-step.service";
export * from "./services/email-automation-trigger.service";
export * from "./services/email-automation-renderer.service";
export * from "./services/email-automation-sender.service";
export * from "./services/email-automation-unsubscribe.service";

// Utils
export * from "./utils/email-markdown.renderer";
export * from "./utils/email-purpose";

// Cron
export * from "./cron/email-automation-sender.cron";
