import { Body, Controller, Get, HttpException, Post, Query, Res, UseGuards } from "@nestjs/common";
import { FastifyReply } from "fastify";
import { ClsService } from "nestjs-cls";
import { JwtAuthGuard } from "../../../common/guards/jwt.auth.guard";
import { OAuthAuthorizeQueryDto, OAuthConsentDecisionDto, OAuthConsentInfoQueryDto } from "../dtos/oauth.authorize.dto";
import { OAuthErrorCodes } from "../constants/oauth.errors";
import { ConsentInfoResponse, OAuthService } from "../services/oauth.service";

/**
 * OAuth Authorization Controller
 *
 * Handles the authorization endpoint (RFC 6749 Section 3.1).
 * Requires user authentication - user must be logged in before authorizing.
 */
@Controller("oauth")
export class OAuthAuthorizeController {
  constructor(
    private readonly oauthService: OAuthService,
    private readonly cls: ClsService,
  ) {}

  /**
   * Authorization Endpoint
   *
   * GET /oauth/authorize
   *
   * Initiates the authorization code flow. User must be authenticated.
   * On success, redirects to redirect_uri with authorization code.
   * On error, redirects to redirect_uri with error details.
   */
  @Get("authorize")
  @UseGuards(JwtAuthGuard)
  async authorize(@Query() query: OAuthAuthorizeQueryDto, @Res() reply: FastifyReply): Promise<void> {
    const userId = this.cls.get("userId");

    if (!userId) {
      // Should not happen if JwtAuthGuard is working
      throw new HttpException("Authentication required", 401);
    }

    try {
      const { code, state } = await this.oauthService.initiateAuthorization({
        responseType: query.response_type,
        clientId: query.client_id,
        redirectUri: query.redirect_uri,
        scope: query.scope,
        state: query.state,
        codeChallenge: query.code_challenge,
        codeChallengeMethod: query.code_challenge_method,
        userId,
      });

      // Build redirect URL with code
      const redirectUrl = new URL(query.redirect_uri);
      redirectUrl.searchParams.set("code", code);
      if (state) {
        redirectUrl.searchParams.set("state", state);
      }

      reply.redirect(redirectUrl.toString(), 302);
    } catch (error) {
      // Redirect with error per RFC 6749 Section 4.1.2.1
      const redirectUrl = new URL(query.redirect_uri);

      if (error instanceof HttpException) {
        const response = error.getResponse();
        const errorBody = typeof response === "object" ? response : { error: "server_error" };
        redirectUrl.searchParams.set("error", (errorBody as any).error || OAuthErrorCodes.SERVER_ERROR);
        if ((errorBody as any).error_description) {
          redirectUrl.searchParams.set("error_description", (errorBody as any).error_description);
        }
      } else {
        redirectUrl.searchParams.set("error", OAuthErrorCodes.SERVER_ERROR);
        redirectUrl.searchParams.set("error_description", "An unexpected error occurred");
      }

      if (query.state) {
        redirectUrl.searchParams.set("state", query.state);
      }

      reply.redirect(redirectUrl.toString(), 302);
    }
  }

  /**
   * Authorization Info Endpoint
   *
   * GET /oauth/authorize/info
   *
   * Returns client information for the consent screen.
   * User must be authenticated to view consent screen.
   */
  @Get("authorize/info")
  @UseGuards(JwtAuthGuard)
  async getAuthorizationInfo(@Query() query: OAuthConsentInfoQueryDto): Promise<ConsentInfoResponse> {
    const userId = this.cls.get("userId");

    return this.oauthService.getConsentInfo({
      clientId: query.client_id,
      redirectUri: query.redirect_uri,
      scope: query.scope,
      userId,
    });
  }

  /**
   * Authorization Approve Endpoint
   *
   * POST /oauth/authorize/approve
   *
   * Called when the user approves the authorization request.
   * Issues an authorization code and returns a redirect URL.
   */
  @Post("authorize/approve")
  @UseGuards(JwtAuthGuard)
  async approveAuthorization(@Body() body: OAuthConsentDecisionDto): Promise<{ meta: { redirectUrl: string } }> {
    const userId = this.cls.get("userId");

    if (!userId) {
      throw new HttpException("Authentication required", 401);
    }

    const result = await this.oauthService.approveAuthorization({
      clientId: body.client_id,
      redirectUri: body.redirect_uri,
      scope: body.scope,
      state: body.state,
      codeChallenge: body.code_challenge,
      codeChallengeMethod: body.code_challenge_method,
      userId,
      companyId: body.company_id,
    });

    return { meta: { redirectUrl: result.redirectUrl } };
  }

  /**
   * Authorization Deny Endpoint
   *
   * POST /oauth/authorize/deny
   *
   * Called when the user denies the authorization request.
   * Returns a redirect URL with error=access_denied.
   */
  @Post("authorize/deny")
  @UseGuards(JwtAuthGuard)
  async denyAuthorization(@Body() body: OAuthConsentDecisionDto): Promise<{ meta: { redirectUrl: string } }> {
    const result = await this.oauthService.denyAuthorization({
      redirectUri: body.redirect_uri,
      state: body.state,
    });

    return { meta: { redirectUrl: result.redirectUrl } };
  }
}
