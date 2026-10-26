import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../services/account-wipe.service", () => ({ AccountWipeService: class {} }));
vi.mock("../services/full-company-deletion.service", () => ({ FullCompanyDeletionService: class {} }));
vi.mock("../../../core/email/services/email.service", () => ({ EmailService: class {} }));

import { AccountDeletionProcessor } from "./account-deletion.processor";

describe("AccountDeletionProcessor", () => {
  let accountWipeService: { deleteAccount: ReturnType<typeof vi.fn> };
  let fullCompanyDeletionService: { wipeCompany: ReturnType<typeof vi.fn> };
  let emailService: { sendEmail: ReturnType<typeof vi.fn> };
  let cls: Map<string, unknown>;
  let clsService: { run: ReturnType<typeof vi.fn>; set: ReturnType<typeof vi.fn> };
  let logger: Record<string, ReturnType<typeof vi.fn>>;
  let processor: AccountDeletionProcessor;

  beforeEach(() => {
    accountWipeService = { deleteAccount: vi.fn().mockResolvedValue(undefined) };
    fullCompanyDeletionService = { wipeCompany: vi.fn().mockResolvedValue(undefined) };
    emailService = { sendEmail: vi.fn().mockResolvedValue(undefined) };
    cls = new Map();
    clsService = {
      run: vi.fn(async (fn: () => Promise<void>) => {
        cls.clear();
        return fn();
      }),
      set: vi.fn((key: string, value: unknown) => cls.set(key, value)),
    };
    logger = { log: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() };
    processor = new AccountDeletionProcessor(
      accountWipeService as never,
      fullCompanyDeletionService as never,
      emailService as never,
      clsService as never,
      logger as never,
    );
  });

  it("delete-account runs the account wipe inside a fresh CLS", async () => {
    await processor.process({ name: "delete-account", data: { userId: "u1" } } as never);

    expect(clsService.run).toHaveBeenCalledTimes(1);
    expect(accountWipeService.deleteAccount).toHaveBeenCalledWith({ userId: "u1" });
  });

  it("delete-company sets the company in CLS and wipes it", async () => {
    fullCompanyDeletionService.wipeCompany.mockImplementation(async () => {
      expect(cls.get("companyId")).toBe("c1");
    });

    await processor.process({ name: "delete-company", data: { companyId: "c1" } } as never);

    expect(fullCompanyDeletionService.wipeCompany).toHaveBeenCalledWith({ companyId: "c1" });
  });

  it("account-deleted-email sends the accountDeleted template in the captured locale", async () => {
    await processor.process({
      name: "account-deleted-email",
      data: { to: "gm@example.com", name: "Gina", locale: "it" },
    } as never);

    expect(emailService.sendEmail).toHaveBeenCalledWith("accountDeleted", { to: "gm@example.com", name: "Gina" }, "it");
  });

  it("ignores an unknown job name", async () => {
    await processor.process({ name: "something-else", id: "j1", data: {} } as never);

    expect(accountWipeService.deleteAccount).not.toHaveBeenCalled();
    expect(fullCompanyDeletionService.wipeCompany).not.toHaveBeenCalled();
    expect(emailService.sendEmail).not.toHaveBeenCalled();
    expect(logger.warn).toHaveBeenCalled();
  });
});
