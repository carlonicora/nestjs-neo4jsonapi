import "reflect-metadata";
import { Controller, Delete, Get, Patch, Post } from "@nestjs/common";
import { MetadataScanner, Reflector } from "@nestjs/core";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { OFFLINE_INTERNAL_HEADER, OFFLINE_REPLAY_HEADER } from "../../../../core/offline/offline.constants";
import { OfflineReplayable } from "../../decorators/offline-replayable.decorator";
import { isOfflineInternalRequest, offlineInternalToken, OfflineRouteRunner } from "../offline-route-runner.service";

@Controller()
class NpcTestController {
  @OfflineReplayable()
  @Post("npcs")
  create() {}

  @OfflineReplayable()
  @Patch("npcs/:npcId")
  update() {}

  @Patch("npcs/merge")
  merge() {}

  @Get("npcs/:npcId")
  read() {}

  @Delete("npcs/:npcId")
  remove() {}
}

const request = {
  headers: {
    authorization: "Bearer abc",
    "x-language": "it",
    "x-companyid": "company-1",
    cookie: "secret",
  },
} as any;

describe("OfflineRouteRunner", () => {
  let inject: ReturnType<typeof vi.fn>;
  let runner: OfflineRouteRunner;

  beforeEach(() => {
    inject = vi.fn().mockResolvedValue({ statusCode: 200, body: JSON.stringify({ data: { type: "npcs", id: "n1" } }) });
    const adapterHost = { httpAdapter: { getInstance: () => ({ inject }) } } as any;
    const discovery = { getControllers: () => [{ metatype: NpcTestController }] } as any;
    runner = new OfflineRouteRunner(adapterHost, discovery, new MetadataScanner(), new Reflector());
  });

  it("injects with the caller's Authorization, x-language, company header, x-offline-replay: 1 and the process token", async () => {
    const body = { data: { type: "npcs", id: "n1", attributes: { name: "B" } } };

    const answer = await runner.run({ method: "PATCH", path: "npcs/n1", body, request });

    expect(inject).toHaveBeenCalledTimes(1);
    const call = inject.mock.calls[0][0];
    expect(call.method).toBe("PATCH");
    expect(call.url).toBe("/npcs/n1");
    expect(call.payload).toEqual(body);
    expect(call.headers).toEqual({
      authorization: "Bearer abc",
      "x-language": "it",
      "x-companyid": "company-1",
      [OFFLINE_REPLAY_HEADER]: "1",
      [OFFLINE_INTERNAL_HEADER]: offlineInternalToken(),
      "content-type": "application/json",
    });
    expect(answer).toEqual({ ran: true, status: 200, body: { data: { type: "npcs", id: "n1" } } });
  });

  it("the token is a random value generated once per process", () => {
    const token = offlineInternalToken();
    expect(token).toMatch(/^[0-9a-f]{64}$/);
    expect(offlineInternalToken()).toBe(token);
    expect(isOfflineInternalRequest({ [OFFLINE_INTERNAL_HEADER]: token })).toBe(true);
    expect(isOfflineInternalRequest({ [OFFLINE_INTERNAL_HEADER]: "0".repeat(64) })).toBe(false);
    expect(isOfflineInternalRequest({})).toBe(false);
  });

  it("a path whose route handler lacks @OfflineReplayable() is answered could-not-apply and never injected", async () => {
    const unmarkedDelete = await runner.run({ method: "DELETE", path: "/npcs/n1", request });
    const staticWins = await runner.run({ method: "PATCH", path: "npcs/merge", body: {}, request });
    const unknown = await runner.run({ method: "POST", path: "discord/post", body: {}, request });

    expect(unmarkedDelete.ran).toBe(false);
    expect(staticWins.ran).toBe(false);
    expect(unknown.ran).toBe(false);
    expect(inject).not.toHaveBeenCalled();
  });

  it("a marked route runs, with the query string kept", async () => {
    await runner.run({ method: "POST", path: "/npcs?include=owner", body: {}, request });
    expect(inject.mock.calls[0][0].url).toBe("/npcs?include=owner");
  });

  it("dot segments are resolved before the marker check, and the resolved path is the one injected", async () => {
    // `npcs/:npcId` is marked for PATCH; `npcs/../discord/post` would run `/discord/post`.
    const escaped = await runner.run({ method: "PATCH", path: "npcs/../discord/post", body: {}, request });
    expect(escaped.ran).toBe(false);
    expect(inject).not.toHaveBeenCalled();

    await runner.run({ method: "PATCH", path: "npcs/x/../n1", body: {}, request });
    expect(inject.mock.calls[0][0].url).toBe("/npcs/n1");
  });

  it("a path that climbs above the root, or carries encoded dot segments or separators, is refused", async () => {
    const paths = [
      "../npcs/n1",
      "https://api.example/../npcs/n1",
      "npcs/%2e%2e/n1",
      "npcs/%2E./n1",
      "npcs/n1%2F..",
      "npcs/..%5Cn1",
    ];
    for (const path of paths) {
      const answer = await runner.run({ method: "PATCH", path, body: {}, request });
      expect(answer.ran, path).toBe(false);
    }
    const read = await runner.run({ method: "GET", path: "../npcs/n1", request });
    expect(read.ran).toBe(false);
    expect(inject).not.toHaveBeenCalled();
  });

  it("reads the current record with a GET, which needs no marker", async () => {
    const answer = await runner.run({ method: "GET", path: "npcs/n1", request });
    expect(inject.mock.calls[0][0].method).toBe("GET");
    expect(inject.mock.calls[0][0].headers["content-type"]).toBeUndefined();
    expect(answer.ran).toBe(true);
  });

  it("an empty answer (204) has no body", async () => {
    inject.mockResolvedValueOnce({ statusCode: 204, body: "" });
    expect(await runner.run({ method: "POST", path: "npcs", body: {}, request })).toEqual({
      ran: true,
      status: 204,
      body: undefined,
    });
  });
});
