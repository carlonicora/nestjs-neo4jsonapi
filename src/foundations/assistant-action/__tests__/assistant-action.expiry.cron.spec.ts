import { vi, describe, it, expect, beforeEach, MockedObject } from "vitest";
import { AssistantActionExpiryCron } from "../cron/assistant-action.expiry.cron";
import { AssistantActionRepository } from "../repositories/assistant-action.repository";
import { AppLoggingService } from "../../../core/logging/services/logging.service";

describe("AssistantActionExpiryCron", () => {
  let cron: AssistantActionExpiryCron;
  let assistantActionRepository: MockedObject<AssistantActionRepository>;
  let logger: MockedObject<AppLoggingService>;

  const MOCK_OVERDUE_ACTIONS = [
    { assistantActionId: "action-1", companyId: "company-1" },
    { assistantActionId: "action-2", companyId: "company-1" },
    { assistantActionId: "action-3", companyId: "company-2" },
  ];

  beforeEach(() => {
    vi.clearAllMocks();
    assistantActionRepository = {
      findAllOverduePendingActions: vi.fn(),
      expireAction: vi.fn(),
    } as unknown as MockedObject<AssistantActionRepository>;
    logger = {
      log: vi.fn(),
      error: vi.fn(),
      warn: vi.fn(),
      debug: vi.fn(),
    } as unknown as MockedObject<AppLoggingService>;
    cron = new AssistantActionExpiryCron(assistantActionRepository, logger);
  });

  describe("handleOverdueActions", () => {
    it("should expire every overdue pending action returned by the repository", async () => {
      assistantActionRepository.findAllOverduePendingActions.mockResolvedValue(MOCK_OVERDUE_ACTIONS);
      assistantActionRepository.expireAction.mockResolvedValue(undefined);
      await cron.handleOverdueActions();
      expect(assistantActionRepository.findAllOverduePendingActions).toHaveBeenCalled();
      expect(assistantActionRepository.expireAction).toHaveBeenCalledTimes(3);
      expect(assistantActionRepository.expireAction).toHaveBeenCalledWith({
        assistantActionId: "action-1",
        companyId: "company-1",
      });
      expect(assistantActionRepository.expireAction).toHaveBeenCalledWith({
        assistantActionId: "action-2",
        companyId: "company-1",
      });
      expect(assistantActionRepository.expireAction).toHaveBeenCalledWith({
        assistantActionId: "action-3",
        companyId: "company-2",
      });
    });

    it("should leave everything untouched when no pending action is overdue", async () => {
      assistantActionRepository.findAllOverduePendingActions.mockResolvedValue([]);
      await cron.handleOverdueActions();
      expect(assistantActionRepository.expireAction).not.toHaveBeenCalled();
    });

    it("should continue expiring remaining actions when one fails", async () => {
      assistantActionRepository.findAllOverduePendingActions.mockResolvedValue(MOCK_OVERDUE_ACTIONS);
      assistantActionRepository.expireAction
        .mockRejectedValueOnce(new Error("Neo4j connection lost"))
        .mockResolvedValueOnce(undefined)
        .mockResolvedValueOnce(undefined);
      await cron.handleOverdueActions();
      expect(assistantActionRepository.expireAction).toHaveBeenCalledTimes(3);
      expect(logger.error).toHaveBeenCalledWith(
        "Failed to expire assistant action action-1 for company company-1: Neo4j connection lost",
        "AssistantActionExpiryCron",
      );
    });
  });
});
