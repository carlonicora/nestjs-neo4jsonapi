/**
 * Timeouts for every S3-compatible client; without them a request on a dead keep-alive socket waits forever.
 * Hetzner answers a GetObject in ~0.1 s, but 1.7% of requests wait 5–74 s for the response headers (p99 9.5 s).
 * socketTimeout is 30 s so those slow answers complete; a probe at 30 s downloaded 3000/3000 objects (10 after one SDK retry).
 * @smithy/node-http-handler clears every timer once the headers arrive, so it never guards the body read:
 * the services that read a body into memory apply S3_BODY_IDLE_TIMEOUT_MS between chunks themselves.
 * throwOnRequestTimeout is required: without it a breached requestTimeout only logs a warning and the request keeps waiting.
 */
const S3_CONNECTION_TIMEOUT_MS = 10_000;
const S3_SOCKET_TIMEOUT_MS = 30_000;
const S3_REQUEST_TIMEOUT_MS = 300_000;

/** Longest wait for the next body chunk before a read into memory is aborted. */
export const S3_BODY_IDLE_TIMEOUT_MS = 30_000;

export const S3_REQUEST_HANDLER = {
  connectionTimeout: S3_CONNECTION_TIMEOUT_MS,
  socketTimeout: S3_SOCKET_TIMEOUT_MS,
  requestTimeout: S3_REQUEST_TIMEOUT_MS,
  throwOnRequestTimeout: true,
};
