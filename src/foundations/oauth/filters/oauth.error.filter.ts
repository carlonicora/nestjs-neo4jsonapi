import { ArgumentsHost, Catch, ExceptionFilter, HttpException, HttpStatus } from "@nestjs/common";
import { FastifyReply } from "fastify";
import { OAuthErrorCodes, OAuthErrorResponse } from "../constants/oauth.errors";

const OAUTH_ERROR_CODES = new Set<string>(Object.values(OAuthErrorCodes));

/**
 * Writes OAuth endpoint errors in the RFC 6749 §5.2 shape:
 * `{ "error": "...", "error_description": "..." }`.
 *
 * The app-wide HttpExceptionFilter wraps every error in a JSON:API envelope,
 * which OAuth clients (MCP SDK, Claude Code, claude.ai) cannot read — they
 * look for a top-level `error` and otherwise surface a generic failure. Bound
 * with @UseFilters on the token and registration controllers, so it runs
 * before the global filter for those routes only.
 */
@Catch()
export class OAuthErrorFilter implements ExceptionFilter {
  catch(exception: unknown, host: ArgumentsHost): void {
    const reply = host.switchToHttp().getResponse<FastifyReply>();
    const { status, body } = this.toOAuthError(exception);

    reply.status(status).header("Cache-Control", "no-store").header("Pragma", "no-cache").send(body);
  }

  private toOAuthError(exception: unknown): { status: number; body: OAuthErrorResponse } {
    if (!(exception instanceof HttpException)) {
      return {
        status: HttpStatus.INTERNAL_SERVER_ERROR,
        body: { error: "server_error", error_description: "Unexpected error" } as OAuthErrorResponse,
      };
    }

    const status = exception.getStatus();
    const response = exception.getResponse();

    // Errors raised through createOAuthError() already carry the RFC shape. Nest's
    // own exceptions also have a string `error` ("Bad Request"), so only a real
    // OAuth error code is passed through as is.
    const oauthResponse = response as Partial<OAuthErrorResponse> | string;
    if (typeof oauthResponse === "object" && oauthResponse?.error && OAUTH_ERROR_CODES.has(oauthResponse.error)) {
      const { error, error_description, error_uri } = oauthResponse as OAuthErrorResponse;
      return { status, body: { error, error_description, ...(error_uri && { error_uri }) } };
    }

    // ValidationPipe failures (missing/invalid form fields).
    if (status === HttpStatus.BAD_REQUEST) {
      const message = (response as { message?: string | string[] })?.message;
      return {
        status,
        body: {
          error: "invalid_request",
          error_description: Array.isArray(message) ? message.join("; ") : (message ?? exception.message),
        } as OAuthErrorResponse,
      };
    }

    return {
      status,
      body: {
        error: status >= 500 ? "server_error" : "invalid_request",
        error_description: exception.message,
      } as OAuthErrorResponse,
    };
  }
}
