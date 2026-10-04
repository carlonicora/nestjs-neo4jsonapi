import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { Logger } from "@nestjs/common";
import { Audit } from "../audit.decorator";
import { DataMeta } from "../../interfaces/datamodel.interface";

const meta = { labelName: "Roll" } as DataMeta;
const ROLL_ID = "550e8400-e29b-41d4-a716-446655440000";

const flush = () => new Promise((resolve) => setImmediate(resolve));

function buildController(logRead: (...args: any[]) => any) {
  class TestController {
    auditService = { logRead };

    @Audit(meta, "rollId")
    async findById(req: any) {
      return { ok: true, id: req.params.rollId };
    }
  }
  return new TestController();
}

describe("Audit decorator", () => {
  let unhandled: unknown[];
  const onUnhandled = (reason: unknown) => unhandled.push(reason);
  let errorSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    unhandled = [];
    process.on("unhandledRejection", onUnhandled);
    errorSpy = vi.spyOn(Logger.prototype, "error").mockImplementation(() => undefined);
  });

  afterEach(() => {
    process.off("unhandledRejection", onUnhandled);
    errorSpy.mockRestore();
  });

  it("logs a read audit with the route param id", async () => {
    const logRead = vi.fn().mockResolvedValue(undefined);
    const controller = buildController(logRead);

    const result = await controller.findById({ params: { rollId: ROLL_ID } });
    await flush();

    expect(result).toEqual({ ok: true, id: ROLL_ID });
    expect(logRead).toHaveBeenCalledWith({ entityType: "Roll", entityId: ROLL_ID });
  });

  it("catches and logs a rejected audit write without an unhandled rejection", async () => {
    const logRead = vi.fn().mockRejectedValue(new Error("Expected parameter(s): companyId"));
    const controller = buildController(logRead);

    const result = await controller.findById({ params: { rollId: ROLL_ID } });
    await flush();
    await flush();

    expect(result).toEqual({ ok: true, id: ROLL_ID });
    expect(unhandled).toEqual([]);
    expect(errorSpy).toHaveBeenCalledWith(
      expect.stringContaining(`Audit read failed for Roll ${ROLL_ID}`),
      expect.any(String),
    );
  });

  it("catches a synchronous throw from the audit service", async () => {
    const logRead = vi.fn(() => {
      throw new Error("boom");
    });
    const controller = buildController(logRead);

    await expect(controller.findById({ params: { rollId: ROLL_ID } })).resolves.toEqual({ ok: true, id: ROLL_ID });
    await flush();

    expect(unhandled).toEqual([]);
    expect(errorSpy).toHaveBeenCalled();
  });

  it("does not audit when the route param is missing", async () => {
    const logRead = vi.fn();
    const controller = buildController(logRead);

    await controller.findById({ params: {} });
    await flush();

    expect(logRead).not.toHaveBeenCalled();
  });
});
