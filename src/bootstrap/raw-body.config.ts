import { NestFastifyApplication } from "@nestjs/platform-fastify";
import { Readable } from "stream";

/**
 * Routes that require raw body access for signature verification.
 * Raw body capture is memory-intensive, so we only enable it for specific routes.
 */
export const RAW_BODY_ROUTES = ["/stripe-webhooks"];

/**
 * Configure raw body capture for specific routes using preParsing hook.
 * This must be called BEFORE routes are registered.
 *
 * @param app - The NestFastify application instance
 */
export async function setupRawBodyCapture(app: NestFastifyApplication): Promise<void> {
  const fastifyInstance = app.getHttpAdapter().getInstance();

  // Use preParsing hook to capture raw body before JSON parsing
  fastifyInstance.addHook("preParsing", async (request, _reply, payload) => {
    // Only capture raw body for specific routes
    if (!RAW_BODY_ROUTES.some((route) => request.url.startsWith(route))) {
      return payload;
    }

    // Collect chunks from the stream
    const chunks: Buffer[] = [];
    for await (const chunk of payload) {
      chunks.push(typeof chunk === "string" ? Buffer.from(chunk) : chunk);
    }

    // Store the raw body on the request
    const rawBody = Buffer.concat(chunks);
    (request as any).rawBody = rawBody;

    // Return a new readable stream for the JSON parser
    return Readable.from(rawBody);
  });
}

/**
 * Path prefix of the token-authorised object upload route (`PUT /s3/objects/:token`).
 */
export const S3_OBJECT_UPLOAD_PATH_PREFIX = "/s3/objects/";

/**
 * Hand the raw request stream of `PUT /s3/objects/:token` to the route handler as `req.body`,
 * whatever content type the browser sent. Fastify picks the parser from `content-type` before
 * `preParsing` runs, so the header is rewritten in `onRequest`. Any other route sending
 * `application/octet-stream` gets 415. This must be called BEFORE routes are registered.
 *
 * @param app - The NestFastify application instance
 */
export function setupS3ObjectUploadStreaming(app: NestFastifyApplication): void {
  const fastifyInstance = app.getHttpAdapter().getInstance();

  fastifyInstance.addHook("onRequest", (request, _reply, done) => {
    if (request.method === "PUT" && request.url.startsWith(S3_OBJECT_UPLOAD_PATH_PREFIX)) {
      request.headers["content-type"] = "application/octet-stream";
    }
    done();
  });

  fastifyInstance.addContentTypeParser("application/octet-stream", (request, payload, done) =>
    request.url.startsWith(S3_OBJECT_UPLOAD_PATH_PREFIX)
      ? done(null, payload)
      : done(Object.assign(new Error("Unsupported Media Type"), { statusCode: 415 }), undefined),
  );
}
