import { ConfigService } from "@nestjs/config";
import { ClsService } from "nestjs-cls";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Mocked } from "vitest";
import { BaseConfigInterface } from "../../../../config/interfaces";
import { EmailService } from "../../../../core/email/services/email.service";
import { JsonApiService } from "../../../../core/jsonapi/services/jsonapi.service";
import { UserRepository } from "../../../user/repositories/user.repository";
import { ResponseLanguageService } from "../../../user/services/response-language.service";
import { WaitlistPostDataDTO } from "../../dtos/waitlist.post.dto";
import { Waitlist, WaitlistStatus } from "../../entities/waitlist";
import { WaitlistRepository } from "../../repositories/waitlist.repository";
import { SIGNUP_SOURCE_FIELDS } from "../../utils/signup-source";
import { WaitlistService } from "../waitlist.service";

describe("WaitlistService", () => {
  let service: WaitlistService;
  let repository: Mocked<Pick<WaitlistRepository, "findByEmail" | "create" | "findByInviteCode" | "markAsRegistered">>;
  let emailService: Mocked<Pick<EmailService, "sendEmail">>;
  let configService: Mocked<Pick<ConfigService, "get">>;
  let responseLanguage: Mocked<Pick<ResponseLanguageService, "resolve">>;

  const entry = {
    id: "waitlist-1",
    email: "gm@example.com",
    status: WaitlistStatus.Invited,
    inviteCode: "invite-1",
    sourceUtmSource: "reddit",
  } as Waitlist;

  const buildData = (attributes: Partial<WaitlistPostDataDTO["attributes"]>): WaitlistPostDataDTO => ({
    type: "waitlists",
    id: "waitlist-1",
    attributes: { email: "gm@example.com", gdprConsent: true, ...attributes },
  });

  beforeEach(() => {
    repository = {
      findByEmail: vi.fn().mockResolvedValue(null),
      create: vi.fn().mockResolvedValue(undefined),
      findByInviteCode: vi.fn(),
      markAsRegistered: vi.fn().mockResolvedValue(undefined),
    };
    emailService = { sendEmail: vi.fn().mockResolvedValue(undefined) };
    configService = { get: vi.fn().mockReturnValue({ url: "https://app.example.com/" }) };
    responseLanguage = { resolve: vi.fn().mockResolvedValue("en") };

    service = new WaitlistService(
      {} as JsonApiService,
      repository as unknown as WaitlistRepository,
      {} as ClsService,
      emailService as unknown as EmailService,
      configService as unknown as ConfigService<BaseConfigInterface>,
      {} as UserRepository,
      responseLanguage as unknown as ResponseLanguageService,
    );
    vi.spyOn(service, "findById").mockResolvedValue({} as any);
  });

  describe("createEntry", () => {
    it("stores sanitised source fields", async () => {
      await service.createEntry({ data: buildData({ sourceUtmSource: " reddit ", sourceRef: "" }) });

      const created = repository.create.mock.calls[0][0];
      expect(created.sourceUtmSource).toBe("reddit");
      expect(created).not.toHaveProperty("sourceRef");
    });

    it("stores none of the six fields without a source", async () => {
      await service.createEntry({ data: buildData({}) });

      const created = repository.create.mock.calls[0][0];
      for (const field of SIGNUP_SOURCE_FIELDS) {
        expect(created).not.toHaveProperty(field);
      }
    });
  });

  describe("markAsRegistered", () => {
    it("returns the marked entry", async () => {
      repository.findByInviteCode.mockResolvedValue(entry);

      const result = await service.markAsRegistered({ inviteCode: "invite-1", userId: "user-1" });

      expect(result).toEqual(entry);
      expect(repository.markAsRegistered).toHaveBeenCalledWith(
        expect.objectContaining({ id: "waitlist-1", userId: "user-1" }),
      );
    });

    it("returns null for an unknown invite code", async () => {
      repository.findByInviteCode.mockResolvedValue(null);

      const result = await service.markAsRegistered({ inviteCode: "unknown", userId: "user-1" });

      expect(result).toBeNull();
      expect(repository.markAsRegistered).not.toHaveBeenCalled();
    });
  });
});
