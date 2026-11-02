import { Injectable } from "@nestjs/common";
import { ClsService } from "nestjs-cls";
import { OFFLINE_CLS_REPLAY } from "./offline.constants";

/**
 * Tells request-scoped code whether the current request is a change replayed from an
 * offline package (`x-offline-replay: 1` plus the runner's process token, recorded in CLS by
 * `OfflineRequestInterceptor`).
 */
@Injectable()
export class OfflineRequestContext {
  constructor(private readonly cls: ClsService) {}

  isReplay(): boolean {
    return this.cls.get(OFFLINE_CLS_REPLAY) === true;
  }
}
