import { ArgumentsHost, Catch, HttpException, Optional } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { FastifyReply } from "fastify";
import { HttpExceptionFilter } from "../../common/filters/http-exception.filter";
import { AppLoggingService } from "../../core/logging/services/logging.service";

/**
 * MCP-scoped exception filter.
 *
 * RFC 9728 requires 401 responses from a protected resource to carry a
 * `WWW-Authenticate` header pointing at the protected-resource metadata so MCP
 * clients can discover the authorization server. On 401 this filter sets that
 * header, then delegates the JSON error body to the library's standard
 * HttpExceptionFilter; every other HttpException is handled identically to the
 * global filter (non-HttpException errors fall through to the global filter
 * because of the `@Catch(HttpException)` scope).
 */
@Catch(HttpException)
export class McpAuthFilter extends HttpExceptionFilter {
  constructor(
    private readonly configService: ConfigService,
    @Optional() logger?: AppLoggingService,
  ) {
    super(logger);
  }

  catch(exception: HttpException, host: ArgumentsHost): void {
    if (exception.getStatus() === 401) {
      const reply = host.switchToHttp().getResponse<FastifyReply>();
      const base = (this.configService.get<{ url: string }>("api")?.url ?? "").replace(/\/$/, "");
      reply.header("WWW-Authenticate", `Bearer resource_metadata="${base}/.well-known/oauth-protected-resource"`);
    }
    super.catch(exception, host);
  }
}
