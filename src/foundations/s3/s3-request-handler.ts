/**
 * Timeouts for every S3-compatible client; without them a request on a dead keep-alive socket waits forever.
 * socketTimeout stays under 6000 ms: @smithy/node-http-handler defers a larger one by 3 s and drops it when headers arrive first, leaving the body read unguarded.
 * throwOnRequestTimeout is required: without it a breached requestTimeout only logs a warning and the request keeps waiting.
 */
const S3_CONNECTION_TIMEOUT_MS = 10_000;
const S3_SOCKET_TIMEOUT_MS = 5_000;
const S3_REQUEST_TIMEOUT_MS = 300_000;

export const S3_REQUEST_HANDLER = {
  connectionTimeout: S3_CONNECTION_TIMEOUT_MS,
  socketTimeout: S3_SOCKET_TIMEOUT_MS,
  requestTimeout: S3_REQUEST_TIMEOUT_MS,
  throwOnRequestTimeout: true,
};
