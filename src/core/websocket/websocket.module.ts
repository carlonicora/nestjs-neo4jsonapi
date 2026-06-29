import { DynamicModule, Global, Module } from "@nestjs/common";
import { createWorkerProvider } from "../../common";
import { EventsGateway } from "./gateways/event.gateway";
import { WsJwtGuard } from "./guards/ws.jwt.auth.guard";
import { PresenceCronService } from "./services/presence.cron.service";
import { PresenceService } from "./services/presence.service";
import { WebSocketService } from "./services/websocket.service";

const WEBSOCKET_SERVICES = [WebSocketService, PresenceService];
const WEBSOCKET_GATEWAY = [EventsGateway];
const WEBSOCKET_GUARDS = [WsJwtGuard];
const WEBSOCKET_CRONS = [createWorkerProvider(PresenceCronService)];

/**
 * WebSocket Module
 *
 * Provides WebSocket gateway functionality with Socket.IO
 *
 * Features:
 * - Real-time bidirectional communication
 * - JWT authentication for WebSocket connections
 * - User presence tracking with Redis
 * - Broadcast messaging capabilities
 * - Event-driven architecture
 *
 * @example
 * ```typescript
 * @Module({
 *   imports: [WebsocketModule],
 * })
 * export class AppModule {}
 * ```
 */
@Global()
@Module({
  providers: [...WEBSOCKET_SERVICES, ...WEBSOCKET_GATEWAY, ...WEBSOCKET_GUARDS, ...WEBSOCKET_CRONS],
  exports: [...WEBSOCKET_SERVICES, ...WEBSOCKET_GUARDS],
})
export class WebsocketModule {
  static forRoot(): DynamicModule {
    return {
      module: WebsocketModule,
      providers: [...WEBSOCKET_SERVICES, ...WEBSOCKET_GATEWAY, ...WEBSOCKET_GUARDS, ...WEBSOCKET_CRONS],
      exports: [...WEBSOCKET_SERVICES, ...WEBSOCKET_GUARDS],
      global: true,
    };
  }
}
