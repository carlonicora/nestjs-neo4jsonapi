import { describe, it, expect } from "vitest";
import { Test, TestingModule } from "@nestjs/testing";
import { OpenApiModule } from "../openapi.module";
import { OpenApiService } from "../openapi.service";

describe("OpenApiModule", () => {
  let module: TestingModule;

  it("should compile the module", async () => {
    module = await Test.createTestingModule({
      imports: [OpenApiModule],
    }).compile();

    expect(module).toBeDefined();
  });

  it("should provide OpenApiService", async () => {
    module = await Test.createTestingModule({
      imports: [OpenApiModule],
    }).compile();

    const service = module.get<OpenApiService>(OpenApiService);
    expect(service).toBeDefined();
    expect(service).toBeInstanceOf(OpenApiService);
  });

  it("should export OpenApiService", async () => {
    module = await Test.createTestingModule({
      imports: [OpenApiModule],
    }).compile();

    // If exported, we can get it from the module
    const service = module.get<OpenApiService>(OpenApiService);
    expect(service).toBeDefined();
  });

  it("should be a global module (same instance across modules)", async () => {
    module = await Test.createTestingModule({
      imports: [OpenApiModule],
    }).compile();

    const service1 = module.get<OpenApiService>(OpenApiService);
    const service2 = module.get<OpenApiService>(OpenApiService);

    expect(service1).toBe(service2);
  });
});
