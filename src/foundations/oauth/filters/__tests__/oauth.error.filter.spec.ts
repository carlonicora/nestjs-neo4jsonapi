import { BadRequestException, HttpException } from "@nestjs/common";
import { describe, expect, it, vi } from "vitest";
import { createOAuthError, OAuthErrorCodes } from "../../constants/oauth.errors";
import { OAuthErrorFilter } from "../oauth.error.filter";

function run(exception: unknown) {
  const reply = { status: vi.fn(), header: vi.fn(), send: vi.fn() };
  reply.status.mockReturnValue(reply);
  reply.header.mockReturnValue(reply);
  const host = { switchToHttp: () => ({ getResponse: () => reply }) } as any;
  new OAuthErrorFilter().catch(exception, host);
  return { status: reply.status.mock.calls[0][0], body: reply.send.mock.calls[0][0] };
}

describe("OAuthErrorFilter", () => {
  it("writes an OAuth error in the RFC 6749 shape, not a JSON:API envelope", () => {
    const { status, body } = run(
      new HttpException(createOAuthError(OAuthErrorCodes.INVALID_GRANT, "Invalid code_verifier"), 400),
    );
    expect(status).toBe(400);
    expect(body).toEqual({ error: "invalid_grant", error_description: "Invalid code_verifier" });
  });

  it("maps a ValidationPipe failure to invalid_request", () => {
    const { status, body } = run(new BadRequestException(["code must be a string", "client_id should not be empty"]));
    expect(status).toBe(400);
    expect(body).toEqual({
      error: "invalid_request",
      error_description: "code must be a string; client_id should not be empty",
    });
  });

  it("maps an unexpected error to a 500 server_error", () => {
    const { status, body } = run(new Error("boom"));
    expect(status).toBe(500);
    expect(body.error).toBe("server_error");
  });
});
