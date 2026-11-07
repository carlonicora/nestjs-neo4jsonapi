import { vi, describe, it, expect } from "vitest";
import type { Mocked } from "vitest";
import { GUARDS_METADATA } from "@nestjs/common/constants";
import { FastifyReply } from "fastify";
import { JwtAuthGuard } from "../../../../common/guards/jwt.auth.guard";
import { AuthenticatedRequest } from "../../../../common/interfaces/authenticated.request.interface";
import { CacheService } from "../../../../core/cache/services/cache.service";
import { JsonApiSingleDocument } from "../../../../core/jsonapi/interfaces/jsonapi.document.interface";
import { AuditService } from "../../../audit/services/audit.service";
import { DiscordConnectIntentService } from "../../services/discord-connect-intent.service";
import { DiscordConnectionService } from "../../services/discord-connection.service";
import { AuthDiscordConnectionController } from "../auth.discord-connection.controller";

describe("AuthDiscordConnectionController", () => {
  const ID = "0b6f8a52-3c0e-4d8e-9a77-6f0c2b1d4e11";

  const build = () => {
    const intentService: Mocked<Pick<DiscordConnectIntentService, "create" | "confirm">> = {
      create: vi.fn(),
      confirm: vi.fn(),
    };
    const connectionService: Mocked<Pick<DiscordConnectionService, "findById">> = { findById: vi.fn() };
    const cacheService: Mocked<Pick<CacheService, "invalidateByType" | "invalidateByElement">> = {
      invalidateByType: vi.fn(),
      invalidateByElement: vi.fn(),
    };
    const auditService: Mocked<Pick<AuditService, "logRead">> = { logRead: vi.fn() };
    const controller = new AuthDiscordConnectionController(
      connectionService as unknown as DiscordConnectionService,
      intentService as unknown as DiscordConnectIntentService,
      cacheService as unknown as CacheService,
      auditService as unknown as AuditService,
    );
    const replyMock: Mocked<Pick<FastifyReply, "header" | "send">> = {
      header: vi.fn().mockReturnThis(),
      send: vi.fn().mockReturnThis(),
    };
    const reply = replyMock as unknown as FastifyReply;
    return { controller, intentService, connectionService, reply };
  };

  it("is session-guarded", () => {
    expect(Reflect.getMetadata(GUARDS_METADATA, AuthDiscordConnectionController)).toEqual([JwtAuthGuard]);
  });

  it("create sets the Set-Cookie header from the service", async () => {
    const { controller, intentService, reply } = build();
    const document = { data: { type: "discord-connect-intents", id: ID } };
    intentService.create.mockResolvedValue({ document, cookie: "discord_connect=k; HttpOnly" });

    await controller.createIntent(reply, {
      data: { type: "discord-connect-intents", id: ID, attributes: { returnPath: "/settings" } },
    });

    expect(intentService.create).toHaveBeenCalledWith({ id: ID, returnPath: "/settings" });
    expect(reply.header).toHaveBeenCalledWith("Set-Cookie", "discord_connect=k; HttpOnly");
    expect(reply.send).toHaveBeenCalledWith(document);
  });

  it("confirm answers the confirmation document", async () => {
    const { controller, intentService, reply } = build();
    const document = { data: { type: "discord-connect-confirmations", id: ID } };
    intentService.confirm.mockResolvedValue(document);

    await controller.createConfirmation(reply, { data: { type: "discord-connect-confirmations", id: ID } });

    expect(intentService.confirm).toHaveBeenCalledWith({ confirmToken: ID });
    expect(reply.send).toHaveBeenCalledWith(document);
  });

  it("findById uses the handler factory", async () => {
    const { controller, connectionService, reply } = build();
    connectionService.findById.mockResolvedValue({ data: { id: "u-1" } } as unknown as JsonApiSingleDocument);

    await controller.findById(
      { params: { discordConnectionId: "u-1" } } as unknown as AuthenticatedRequest,
      reply,
      "u-1",
    );

    expect(connectionService.findById).toHaveBeenCalledWith({ id: "u-1" });
    expect(reply.send).toHaveBeenCalledWith({ data: { id: "u-1" } });
  });
});
