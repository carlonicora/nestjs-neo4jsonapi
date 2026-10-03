import { getQueueToken } from "@nestjs/bullmq";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { APP_MODE_TOKEN } from "../../../common/decorators/conditional-service.decorator";
import { modelRegistry } from "../../../common/registries/registry";

// The classes registered here are owned by sibling files; each is replaced by
// an inert stand-in so this spec exercises the module wiring alone.
vi.mock("../entities/analytics-session", () => ({
  AnalyticsSessionDescriptor: {
    model: { type: "analytics-sessions", serialiser: class AnalyticsSessionSerialiser {} },
  },
}));
vi.mock("../entities/analytics-page-view", () => ({
  AnalyticsPageViewDescriptor: {
    model: { type: "analytics-pageviews", serialiser: class AnalyticsPageViewSerialiser {} },
  },
}));
vi.mock("../entities/analytics-daily-summary", () => ({
  AnalyticsDailySummaryDescriptor: {
    model: { type: "analytics-daily-summaries", serialiser: class AnalyticsDailySummarySerialiser {} },
  },
}));
vi.mock("../entities/analytics-summary", () => ({
  AnalyticsSummaryDescriptor: {
    model: { type: "analytics-summaries", serialiser: class AnalyticsSummarySerialiser {} },
  },
}));
vi.mock("../entities/analytics-timeline", () => ({
  AnalyticsTimelineDescriptor: {
    model: { type: "analytics-timelines", serialiser: class AnalyticsTimelineSerialiser {} },
  },
}));
vi.mock("../entities/analytics-breakdown", () => ({
  AnalyticsBreakdownDescriptor: {
    model: { type: "analytics-breakdowns", serialiser: class AnalyticsBreakdownSerialiser {} },
  },
}));
vi.mock("../interfaces/analytics.config.interface", () => ({
  ANALYTICS_CONFIG: Symbol("ANALYTICS_CONFIG"),
  ANALYTICS_QUEUE: Symbol("ANALYTICS_QUEUE"),
  DEFAULT_ANALYTICS_CONFIG: {
    enabled: false,
    retentionMonths: 13,
    sessionTimeoutMinutes: 30,
    queueId: "analytics",
    jobName: "analytics:pageView",
  },
}));
vi.mock("../repositories/analytics-session.repository", () => ({ AnalyticsSessionRepository: class {} }));
vi.mock("../repositories/analytics-page-view.repository", () => ({ AnalyticsPageViewRepository: class {} }));
vi.mock("../repositories/analytics-daily-summary.repository", () => ({ AnalyticsDailySummaryRepository: class {} }));
vi.mock("../repositories/analytics.admin.repository", () => ({ AnalyticsAdminRepository: class {} }));
vi.mock("../services/analytics.visitor-id.service", () => ({ AnalyticsVisitorIdService: class {} }));
vi.mock("../services/analytics.service", () => ({ AnalyticsService: class {} }));
vi.mock("../services/analytics.admin.service", () => ({ AnalyticsAdminService: class {} }));
vi.mock("../controllers/analytics.controller", () => ({ AnalyticsController: class {} }));
vi.mock("../controllers/analytics.admin.controller", () => ({ AnalyticsAdminController: class {} }));
vi.mock("../processors/analytics.processor", () => ({ AnalyticsProcessor: class {} }));
vi.mock("../../audit/audit.module", () => ({ AuditModule: class AuditModule {} }));
// `baseConfig` is normally built once at import time. The getter rebuilds it
// with the real `createBaseConfig()` on every read, so each case can stub the
// environment and exercise the real ANALYTICS_* parsing.
vi.mock("../../../config/base.config", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../../config/base.config")>();
  return {
    ...actual,
    get baseConfig() {
      return actual.createBaseConfig();
    },
  };
});

import { AuditModule } from "../../audit/audit.module";
import { AnalyticsModule } from "../analytics.module";
import { AnalyticsAdminController } from "../controllers/analytics.admin.controller";
import { AnalyticsController } from "../controllers/analytics.controller";
import { AnalyticsRetentionCron } from "../cron/analytics-retention.cron";
import { AnalyticsBreakdownDescriptor } from "../entities/analytics-breakdown";
import { AnalyticsDailySummaryDescriptor } from "../entities/analytics-daily-summary";
import { AnalyticsPageViewDescriptor } from "../entities/analytics-page-view";
import { AnalyticsSessionDescriptor } from "../entities/analytics-session";
import { AnalyticsSummaryDescriptor } from "../entities/analytics-summary";
import { AnalyticsTimelineDescriptor } from "../entities/analytics-timeline";
import { ANALYTICS_CONFIG, ANALYTICS_QUEUE } from "../interfaces/analytics.config.interface";
import { AnalyticsProcessor } from "../processors/analytics.processor";
import { AnalyticsDailySummaryRepository } from "../repositories/analytics-daily-summary.repository";
import { AnalyticsPageViewRepository } from "../repositories/analytics-page-view.repository";
import { AnalyticsSessionRepository } from "../repositories/analytics-session.repository";
import { AnalyticsAdminRepository } from "../repositories/analytics.admin.repository";
import { AnalyticsAdminService } from "../services/analytics.admin.service";
import { AnalyticsService } from "../services/analytics.service";
import { AnalyticsVisitorIdService } from "../services/analytics.visitor-id.service";

const providerTokens = (providers: readonly any[]) => providers.map((p) => (typeof p === "function" ? p : p.provide));

const descriptors: any[] = [
  AnalyticsSessionDescriptor,
  AnalyticsPageViewDescriptor,
  AnalyticsDailySummaryDescriptor,
  AnalyticsSummaryDescriptor,
  AnalyticsTimelineDescriptor,
  AnalyticsBreakdownDescriptor,
];

describe("AnalyticsModule.forRoot", () => {
  beforeEach(() => {
    vi.stubEnv("ANALYTICS_ENABLED", undefined);
    vi.stubEnv("ANALYTICS_RETENTION_MONTHS", undefined);
    vi.stubEnv("ANALYTICS_SESSION_TIMEOUT_MINUTES", undefined);
  });

  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllEnvs();
  });

  it("is inert by default", () => {
    const module = AnalyticsModule.forRoot();

    expect(module.module).toBe(AnalyticsModule);
    expect(module.providers).toEqual([]);
    expect(module.controllers).toEqual([]);
    expect(module.imports).toEqual([]);
  });

  it("is inert when enabled is explicitly false", () => {
    const module = AnalyticsModule.forRoot({ enabled: false, retentionMonths: 6 });

    expect(module.providers).toEqual([]);
    expect(module.controllers).toEqual([]);
    expect(module.imports).toEqual([]);
  });

  it("registers queue, controllers, repositories, services, worker processor and cron when enabled", () => {
    const module = AnalyticsModule.forRoot({ enabled: true });
    const providers = module.providers as any[];
    const tokens = providerTokens(providers);

    expect(module.global).toBe(true);

    expect(module.imports).toHaveLength(2);
    const queueModule = module.imports![0] as any;
    expect(providerTokens(queueModule.providers)).toContain(getQueueToken("analytics"));
    expect(module.imports![1]).toBe(AuditModule);

    expect(module.controllers).toEqual([AnalyticsController, AnalyticsAdminController]);

    const config = providers.find((p) => p.provide === ANALYTICS_CONFIG);
    expect(config.useValue).toEqual({
      enabled: true,
      retentionMonths: 13,
      sessionTimeoutMinutes: 30,
      queueId: "analytics",
      jobName: "analytics:pageView",
    });

    const alias = providers.find((p) => p.provide === ANALYTICS_QUEUE);
    expect(alias.useExisting).toBe(getQueueToken("analytics"));

    for (const descriptor of descriptors) expect(tokens).toContain(descriptor.model.serialiser);

    for (const repository of [
      AnalyticsSessionRepository,
      AnalyticsPageViewRepository,
      AnalyticsDailySummaryRepository,
      AnalyticsAdminRepository,
    ])
      expect(tokens).toContain(repository);

    for (const service of [AnalyticsVisitorIdService, AnalyticsService, AnalyticsAdminService])
      expect(tokens).toContain(service);

    for (const workerClass of [AnalyticsProcessor, AnalyticsRetentionCron]) {
      const provider = providers.find((p) => typeof p === "object" && p.provide === workerClass);
      expect(provider).toBeDefined();
      expect(typeof provider.useFactory).toBe("function");
      expect(provider.inject[0]).toBe(APP_MODE_TOKEN);
    }

    expect(module.exports).toEqual([AnalyticsService, AnalyticsAdminService, ANALYTICS_CONFIG]);
  });

  it("merges partial config over the defaults and aliases the configured queue", () => {
    const module = AnalyticsModule.forRoot({ enabled: true, retentionMonths: 6, queueId: "custom-analytics" });
    const providers = module.providers as any[];

    expect(providers.find((p) => p.provide === ANALYTICS_CONFIG).useValue).toEqual({
      enabled: true,
      retentionMonths: 6,
      sessionTimeoutMinutes: 30,
      queueId: "custom-analytics",
      jobName: "analytics:pageView",
    });
    expect(providers.find((p) => p.provide === ANALYTICS_QUEUE).useExisting).toBe(getQueueToken("custom-analytics"));
  });

  it("is enabled by ANALYTICS_ENABLED=true with no config", () => {
    vi.stubEnv("ANALYTICS_ENABLED", "true");
    vi.stubEnv("ANALYTICS_RETENTION_MONTHS", "6");

    const module = AnalyticsModule.forRoot();
    const providers = module.providers as any[];

    expect(module.controllers).toEqual([AnalyticsController, AnalyticsAdminController]);
    expect(providers.find((p) => p.provide === ANALYTICS_CONFIG).useValue).toEqual({
      enabled: true,
      retentionMonths: 6,
      sessionTimeoutMinutes: 30,
      queueId: "analytics",
      jobName: "analytics:pageView",
    });
  });

  it("is inert when ANALYTICS_ENABLED is unset and no config is passed", () => {
    const module = AnalyticsModule.forRoot();

    expect(module.providers).toEqual([]);
    expect(module.controllers).toEqual([]);
    expect(module.imports).toEqual([]);
  });

  it("an explicit { enabled: false } beats ANALYTICS_ENABLED=true", () => {
    vi.stubEnv("ANALYTICS_ENABLED", "true");

    const module = AnalyticsModule.forRoot({ enabled: false });

    expect(module.providers).toEqual([]);
    expect(module.controllers).toEqual([]);
    expect(module.imports).toEqual([]);
  });

  it("onModuleInit registers every descriptor model", () => {
    const register = vi.spyOn(modelRegistry, "register").mockImplementation(() => undefined as any);

    new AnalyticsModule().onModuleInit();

    expect(register).toHaveBeenCalledTimes(6);
    for (const descriptor of descriptors) expect(register).toHaveBeenCalledWith(descriptor.model);
  });
});
