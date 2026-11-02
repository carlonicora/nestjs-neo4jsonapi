import { SetMetadata } from "@nestjs/common";

export const OFFLINE_REPLAYABLE_METADATA = "offline:replayable";

/**
 * Marks a write route an offline change set may run. The offline route runner refuses
 * every write whose route handler does not carry it (answered could-not-apply, never run).
 */
export const OfflineReplayable = (): MethodDecorator => SetMetadata(OFFLINE_REPLAYABLE_METADATA, true);
