import { OnModuleDestroy, UseInterceptors } from "@nestjs/common";
import { EventEmitter2 } from "@nestjs/event-emitter";
import { JwtService } from "@nestjs/jwt";
import {
  ConnectedSocket,
  MessageBody,
  OnGatewayConnection,
  OnGatewayDisconnect,
  OnGatewayInit,
  SubscribeMessage,
  WebSocketGateway,
  WebSocketServer,
} from "@nestjs/websockets";
import { ClsInterceptor, ClsService } from "nestjs-cls";
import { Server, Socket } from "socket.io";
import { AppLoggingService } from "../../logging/services/logging.service";
import { Neo4jService } from "../../neo4j/services/neo4j.service";
import { PresenceService } from "../services/presence.service";
import { WebSocketService } from "../services/websocket.service";

const WS_BUILTIN_EVENTS = new Set(["message", "heartbeat"]);

@WebSocketGateway({
  path: "/socket.io",
  cors: {
    origin: "*",
    credentials: true,
  },
  transports: ["websocket"],
})
@UseInterceptors(ClsInterceptor)
export class EventsGateway implements OnGatewayInit, OnGatewayConnection, OnGatewayDisconnect, OnModuleDestroy {
  @WebSocketServer()
  server: Server;

  private isShuttingDown = false;

  constructor(
    private readonly webSocketService: WebSocketService,
    private readonly jwtService: JwtService,
    private readonly cls: ClsService,
    private readonly neo4j: Neo4jService,
    private readonly logger: AppLoggingService,
    private readonly presenceService: PresenceService,
    private readonly eventEmitter: EventEmitter2,
  ) {}

  afterInit() {
    this.webSocketService.setServer(this.server);
    this.logger.log("WebSocket server initialized");
  }

  async handleConnection(client: Socket) {
    const token = this.extractTokenFromHandshake(client);

    if (!token) {
      client.data.user = { userId: null };
      return;
    } else {
      try {
        const payload = this.jwtService.verify(token);
        client.data.user = payload;

        this.webSocketService.addClient(payload.userId, client);

        // Set user as online
        await this.presenceService.setUserOnline(payload.userId, payload.userName || payload.name, client.id);

        // Broadcast presence change
        const broadcastPayload = {
          userId: payload.userId,
          status: "online",
        };
        await this.webSocketService.broadcast("user:presence", broadcastPayload);

        client.onAny((event: string, eventPayload: unknown) => {
          if (WS_BUILTIN_EVENTS.has(event)) return;
          this.eventEmitter.emit(`ws:${event}`, { user: client.data.user, payload: eventPayload, client });
        });
      } catch (err: any) {
        this.logger.error(`[PRESENCE] JWT verification failed for client: ${client.id}, error: ${err.message}`);
        client.data.user = { userId: null };
      }
    }
  }

  async handleDisconnect(client: Socket) {
    // Skip Redis operations if shutting down
    if (this.isShuttingDown) {
      return;
    }

    const user = client.data.user;
    if (user && user.userId) {
      this.webSocketService.removeClient(user.userId, client);

      // Set user offline and broadcast
      try {
        await this.presenceService.setUserOffline(user.userId, client.id);
        const status = await this.presenceService.getUserStatus(user.userId);

        if (status.status === "offline") {
          const broadcastPayload = {
            userId: user.userId,
            status: "offline",
            lastSeen: status.lastActivity,
          };
          await this.webSocketService.broadcast("user:presence", broadcastPayload);
        }
      } catch (error: any) {
        // Redis might be disconnected during shutdown
        this.logger.error(`[PRESENCE] Error setting user offline: ${error.message}`);
      }
    }
  }

  async onModuleDestroy() {
    this.isShuttingDown = true;
  }

  @SubscribeMessage("heartbeat")
  async handleHeartbeat(@ConnectedSocket() client: Socket) {
    const user = client.data.user;
    if (user && user.userId) {
      await this.presenceService.updateActivity(user.userId);
    }
    return { event: "heartbeat", data: { status: "ok" } };
  }

  @SubscribeMessage("message")
  handleMessage(
    @MessageBody() data: { type: string; message: any },
    @ConnectedSocket() client: Socket,
  ): { event: string; data: any } {
    const user = client.data.user;
    if (user && user.userId && user.companyId) {
      this.webSocketService.handleIncomingMessage(user.companyId, user.userId, data);
    }
    return { event: "message", data: { status: "received" } };
  }

  private extractTokenFromHandshake(client: Socket): string | null {
    const token = client.handshake.auth?.token;

    if (token) return token as string;

    const queryToken = client.handshake.query.token;
    const authHeader = client.handshake.headers.authorization;

    if (queryToken) {
      return queryToken as string;
    } else if (authHeader && authHeader.startsWith("Bearer ")) {
      return authHeader.slice(7);
    }
    return null;
  }
}
