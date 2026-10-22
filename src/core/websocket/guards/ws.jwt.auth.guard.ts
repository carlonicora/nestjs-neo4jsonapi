import { CanActivate, ExecutionContext, Injectable } from "@nestjs/common";
import { JwtService } from "@nestjs/jwt";
import { ClsService } from "nestjs-cls";
import { Socket } from "socket.io";
import { isSessionPayload } from "../../../common/guards/session.token";
import { Neo4jService } from "../../neo4j/services/neo4j.service";

@Injectable()
export class WsJwtGuard implements CanActivate {
  constructor(
    private readonly jwtService: JwtService,
    private readonly cls: ClsService,
    private readonly neo4j: Neo4jService,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const client: Socket = context.switchToWs().getClient();
    const token = this.extractTokenFromHandshake(client);

    if (!token) {
      return false;
    }

    try {
      const payload = this.jwtService.verify(token);
      // Only a full session: pending-2FA, selection and portal tokens share the secret.
      if (!isSessionPayload(payload)) return false;
      client.data.user = payload;

      return true;
    } catch (err) {
      console.error(err);
      return false;
    }
  }

  private extractTokenFromHandshake(client: Socket): string | null {
    const token = client.handshake.auth?.token;

    if (token) {
      return token as string;
    }

    const { token: queryToken } = client.handshake.query;
    const authHeader = client.handshake.headers.authorization;

    if (queryToken) {
      return queryToken as string;
    } else if (authHeader && authHeader.startsWith("Bearer ")) {
      return authHeader.slice(7);
    }
    return null;
  }
}
