import { vi, describe, it, expect, type Mocked } from "vitest";
import { ClsService } from "nestjs-cls";
import { JsonApiService } from "../../../../core/jsonapi/services/jsonapi.service";
import { DiscordConnectionDescriptor } from "../../entities/discord-connection";
import { DiscordConnectionRepository } from "../../repositories/discord-connection.repository";
import { DiscordConnectionService } from "../discord-connection.service";

describe("DiscordConnectionService", () => {
  it("findById returns the repository document", async () => {
    const record = { id: "u-1", connected: true, discordName: "player" };
    const repository = {
      findCurrent: vi.fn().mockResolvedValue(record),
    } as unknown as Mocked<DiscordConnectionRepository>;
    const document = { data: { type: "discord-connections", id: "u-1" } };
    const jsonApiService = { buildSingle: vi.fn().mockResolvedValue(document) } as unknown as Mocked<JsonApiService>;
    const service = new DiscordConnectionService(jsonApiService, repository, {} as ClsService);

    await expect(service.findById({ id: "u-1" })).resolves.toBe(document);
    expect(repository.findCurrent).toHaveBeenCalledWith({ id: "u-1" });
    expect(jsonApiService.buildSingle).toHaveBeenCalledWith(DiscordConnectionDescriptor.model, record);
  });
});
