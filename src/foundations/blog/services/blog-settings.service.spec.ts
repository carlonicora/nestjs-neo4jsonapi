import { BadRequestException } from "@nestjs/common";
import { Test } from "@nestjs/testing";
import { ClsService } from "nestjs-cls";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Mocked } from "vitest";
import { JsonApiService } from "../../../core/jsonapi/services/jsonapi.service";
import { BLOG_SETTINGS_ID } from "../blog.constants";
import { BlogSettingsPutDTO } from "../dtos/blog-settings.put.dto";
import { blogSettingsMeta } from "../entities/blog-settings.meta";
import { BlogSettingsRepository } from "../repositories/blog-settings.repository";
import { BlogSettingsService } from "./blog-settings.service";

describe("BlogSettingsService", () => {
  let service: BlogSettingsService;
  let repo: Mocked<Pick<BlogSettingsRepository, "findSettings" | "upsert">>;
  let jsonApiService: Mocked<Pick<JsonApiService, "buildSingle">>;

  beforeEach(async () => {
    repo = { findSettings: vi.fn().mockResolvedValue(null), upsert: vi.fn() };
    jsonApiService = { buildSingle: vi.fn().mockResolvedValue({ data: {} }) };

    const module = await Test.createTestingModule({
      providers: [
        BlogSettingsService,
        { provide: JsonApiService, useValue: jsonApiService },
        { provide: BlogSettingsRepository, useValue: repo },
        { provide: ClsService, useValue: { get: vi.fn() } },
      ],
    }).compile();

    service = module.get(BlogSettingsService);
  });

  afterEach(() => vi.clearAllMocks());

  it("getSettings defaults to the featured layout when nothing is stored", async () => {
    await service.getSettings();

    expect(jsonApiService.buildSingle).toHaveBeenCalledWith(expect.anything(), {
      id: BLOG_SETTINGS_ID,
      listLayout: "featured",
    });
  });

  it("saveSettings upserts the layout", async () => {
    await service.saveSettings({
      data: {
        id: BLOG_SETTINGS_ID,
        type: blogSettingsMeta.endpoint,
        attributes: { listLayout: "rail" },
      } as BlogSettingsPutDTO["data"],
    });

    expect(repo.upsert).toHaveBeenCalledWith({ listLayout: "rail" });
  });

  it("saveSettings refuses any id but BLOG_SETTINGS_ID", async () => {
    await expect(
      service.saveSettings({
        data: {
          id: "00000000-0000-4000-8000-000000000000",
          type: blogSettingsMeta.endpoint,
          attributes: { listLayout: "rail" },
        } as BlogSettingsPutDTO["data"],
      }),
    ).rejects.toThrow(BadRequestException);
    expect(repo.upsert).not.toHaveBeenCalled();
  });
});
