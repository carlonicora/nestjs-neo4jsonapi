import { Injectable, RequestMethod } from "@nestjs/common";
import { METHOD_METADATA, PATH_METADATA } from "@nestjs/common/constants";
import { DiscoveryService, HttpAdapterHost, MetadataScanner, Reflector } from "@nestjs/core";
import { randomBytes, timingSafeEqual } from "crypto";
import type { FastifyRequest } from "fastify";
import { OFFLINE_INTERNAL_HEADER, OFFLINE_REPLAY_HEADER } from "../../../core/offline/offline.constants";
import { OFFLINE_REPLAYABLE_METADATA } from "../decorators/offline-replayable.decorator";

let processToken: string | undefined;

/**
 * The per-process token every step of an offline change set carries in `x-offline-internal`.
 * Random, generated on first use, never leaves the process: only requests this runner injects
 * carry it, so the throttler can tell them from client requests (one package = one request).
 */
export function offlineInternalToken(): string {
  if (!processToken) processToken = randomBytes(32).toString("hex");
  return processToken;
}

/** True when the headers carry this process's `x-offline-internal` token. */
export function isOfflineInternalRequest(headers: Record<string, unknown> | undefined): boolean {
  const raw = headers?.[OFFLINE_INTERNAL_HEADER];
  const value = Array.isArray(raw) ? raw[0] : raw;
  if (typeof value !== "string" || value.length === 0) return false;
  const expected = Buffer.from(offlineInternalToken());
  const given = Buffer.from(value);
  return given.length === expected.length && timingSafeEqual(given, expected);
}

export type OfflineRouteMethod = "GET" | "POST" | "PUT" | "PATCH" | "DELETE";

/** `ran: false` = refused without running (the route is not marked `@OfflineReplayable()`). */
export type OfflineRouteAnswer = { ran: true; status: number; body: any } | { ran: false; detail: string };

type KnownRoute = { method: string; segments: string[]; replayable: boolean };

/** Headers of the caller's request carried into every injected step. */
const FORWARDED_HEADERS = ["authorization", "x-language", "x-companyid"];

const splitPath = (path: string): string[] => path.split("/").filter((s) => s.length > 0);

const firstPath = (value: unknown): string => (Array.isArray(value) ? String(value[0] ?? "") : String(value ?? ""));

/**
 * Runs one step of an offline change set through the app's own route with Fastify `inject`,
 * as the caller: the caller's `Authorization`, `x-language` and `x-companyid` headers, plus
 * `x-offline-replay: 1` and the process token. Every read and write therefore goes through
 * the app's controller → service → repository, with its guards, validation and checks.
 *
 * A write (POST/PUT/PATCH/DELETE) runs only when the route that would answer it carries
 * `@OfflineReplayable()`; any other write is refused without running. A GET (reading the
 * current record before a merge) needs no marker: it changes nothing.
 *
 * Infrastructure provider: it owns no entity and touches no Neo4j itself.
 */
@Injectable()
export class OfflineRouteRunner {
  private routes: KnownRoute[] | undefined;

  constructor(
    private readonly adapterHost: HttpAdapterHost,
    private readonly discovery: DiscoveryService,
    private readonly metadataScanner: MetadataScanner,
    private readonly reflector: Reflector,
  ) {}

  async run(params: {
    method: OfflineRouteMethod;
    path: string;
    body?: unknown;
    request: FastifyRequest;
  }): Promise<OfflineRouteAnswer> {
    const url = this.normalise(params.path);
    if (url === undefined)
      return { ran: false, detail: `${params.method} ${params.path} is not a path an offline change set can run` };

    if (params.method !== "GET") {
      const route = this.match(params.method, url.split("?")[0]);
      if (!route?.replayable)
        return { ran: false, detail: `${params.method} ${url} cannot be run from an offline change set` };
    }

    const headers: Record<string, string> = {};
    const source = (params.request?.headers ?? {}) as Record<string, unknown>;
    for (const name of FORWARDED_HEADERS) {
      const value = source[name];
      if (typeof value === "string" && value.length > 0) headers[name] = value;
    }
    headers[OFFLINE_REPLAY_HEADER] = "1";
    headers[OFFLINE_INTERNAL_HEADER] = offlineInternalToken();
    if (params.body !== undefined) headers["content-type"] = "application/json";

    const response = await this.adapterHost.httpAdapter.getInstance().inject({
      method: params.method,
      url,
      headers,
      ...(params.body !== undefined ? { payload: params.body } : {}),
    });

    return { ran: true, status: response.statusCode, body: this.parse(response.body) };
  }

  /**
   * `npcs/n1`, `/npcs/n1` or an absolute URL → `/npcs/n1` (query string kept), with dot segments
   * resolved the way the router resolves them, so the route checked is the route that runs.
   * `undefined` (refused) for a path that climbs above the root, or that carries an encoded dot
   * or separator (`%2e`, `%2f`, `%5c`), which a later decode could turn into another path.
   */
  private normalise(path: string): string | undefined {
    const absolute = /^https?:\/\//i.test(path);
    // The path as sent (an absolute URL's pathname is already resolved by URL, so read it raw).
    const raw = (absolute ? path.replace(/^https?:\/\/[^/?#]*/i, "") : path).split(/[?#]/)[0];
    if (/%2e|%2f|%5c/i.test(raw)) return undefined;

    let depth = 0;
    for (const segment of raw.split(/[\/\\]/)) {
      if (segment === "" || segment === ".") continue;
      depth += segment === ".." ? -1 : 1;
      if (depth < 0) return undefined;
    }

    const parsed = absolute ? new URL(path) : new URL(`/${path.replace(/^[\/\\]+/, "")}`, "http://internal");
    const pathname = parsed.pathname.replace(/\/{2,}/g, "/");
    return `${pathname}${parsed.search}`;
  }

  private parse(body: string | undefined): any {
    if (body === undefined || body === "") return undefined;
    try {
      return JSON.parse(body);
    } catch {
      return body;
    }
  }

  /**
   * The route that answers `method path`, with the router's precedence: a static segment
   * beats a parameter, a parameter beats a wildcard, compared from the first segment.
   */
  private match(method: string, path: string): KnownRoute | undefined {
    const segments = splitPath(path);
    const rank = (segment: string): number => (segment === "*" ? 0 : segment.startsWith(":") ? 1 : 2);

    const candidates = this.knownRoutes().filter((route) => {
      if (route.method !== method && route.method !== "ALL") return false;
      const wildcard = route.segments[route.segments.length - 1] === "*";
      if (!wildcard && route.segments.length !== segments.length) return false;
      if (wildcard && segments.length < route.segments.length - 1) return false;
      return route.segments.every(
        (segment, index) => segment === "*" || segment.startsWith(":") || segment === segments[index],
      );
    });

    candidates.sort((a, b) => {
      const length = Math.max(a.segments.length, b.segments.length);
      for (let index = 0; index < length; index++) {
        const diff = rank(b.segments[index] ?? "*") - rank(a.segments[index] ?? "*");
        if (diff !== 0) return diff;
      }
      return 0;
    });

    return candidates[0];
  }

  private knownRoutes(): KnownRoute[] {
    if (this.routes) return this.routes;
    const routes: KnownRoute[] = [];

    for (const wrapper of this.discovery.getControllers()) {
      const controller = wrapper.metatype as any;
      if (typeof controller !== "function" || !controller.prototype) continue;
      const prototype = controller.prototype;
      const controllerPath = firstPath(this.reflector.get(PATH_METADATA, controller));

      for (const methodName of this.metadataScanner.getAllMethodNames(prototype)) {
        const handler = prototype[methodName];
        if (typeof handler !== "function") continue;
        const requestMethod = this.reflector.get<RequestMethod>(METHOD_METADATA, handler);
        const routePath = this.reflector.get(PATH_METADATA, handler);
        if (requestMethod === undefined || routePath === undefined) continue;

        routes.push({
          method: RequestMethod[requestMethod] ?? String(requestMethod),
          segments: [...splitPath(controllerPath), ...splitPath(firstPath(routePath))],
          replayable: this.reflector.get<boolean>(OFFLINE_REPLAYABLE_METADATA, handler) === true,
        });
      }
    }

    this.routes = routes;
    return routes;
  }
}
