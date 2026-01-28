import { describe, it, expect, vi, beforeEach } from "vitest";
import { PreconditionFailedException } from "@nestjs/common";
import { ValidateId } from "../validate-id.decorator";

const TEST_IDS = {
  entityId: "550e8400-e29b-41d4-a716-446655440000",
  differentId: "660e8400-e29b-41d4-a716-446655440001",
};

describe("ValidateId decorator", () => {
  describe("decorator factory", () => {
    it("should return a decorator function", () => {
      const decorator = ValidateId("testId");
      expect(typeof decorator).toBe("function");
    });
  });

  describe("ID validation", () => {
    it("should allow when both IDs match", async () => {
      const originalMethod = vi.fn().mockResolvedValue("success");

      class TestController {
        @ValidateId("entityId")
        async testMethod(...args: any[]) {
          return originalMethod(...args);
        }
      }

      const controller = new TestController();
      const req = { params: { entityId: TEST_IDS.entityId } };
      const body = { data: { id: TEST_IDS.entityId } };

      const result = await controller.testMethod(req, body);

      expect(result).toBe("success");
      expect(originalMethod).toHaveBeenCalledTimes(1);
    });

    it("should throw PreconditionFailedException when IDs do not match", async () => {
      const originalMethod = vi.fn().mockResolvedValue("success");

      class TestController {
        @ValidateId("entityId")
        async testMethod(...args: any[]) {
          return originalMethod(...args);
        }
      }

      const controller = new TestController();
      const req = { params: { entityId: TEST_IDS.entityId } };
      const body = { data: { id: TEST_IDS.differentId } };

      await expect(controller.testMethod(req, body)).rejects.toThrow(PreconditionFailedException);
      await expect(controller.testMethod(req, body)).rejects.toThrow("ID in URL does not match ID in body");
      expect(originalMethod).not.toHaveBeenCalled();
    });

    it("should allow when paramId is missing (no params object)", async () => {
      const originalMethod = vi.fn().mockResolvedValue("success");

      class TestController {
        @ValidateId("entityId")
        async testMethod(...args: any[]) {
          return originalMethod(...args);
        }
      }

      const controller = new TestController();
      const body = { data: { id: TEST_IDS.entityId } };

      const result = await controller.testMethod(body);

      expect(result).toBe("success");
      expect(originalMethod).toHaveBeenCalledTimes(1);
    });

    it("should allow when paramId is undefined in params", async () => {
      const originalMethod = vi.fn().mockResolvedValue("success");

      class TestController {
        @ValidateId("entityId")
        async testMethod(...args: any[]) {
          return originalMethod(...args);
        }
      }

      const controller = new TestController();
      const req = { params: { otherId: "different" } };
      const body = { data: { id: TEST_IDS.entityId } };

      const result = await controller.testMethod(req, body);

      expect(result).toBe("success");
      expect(originalMethod).toHaveBeenCalledTimes(1);
    });

    it("should allow when bodyId is missing (no data property)", async () => {
      const originalMethod = vi.fn().mockResolvedValue("success");

      class TestController {
        @ValidateId("entityId")
        async testMethod(...args: any[]) {
          return originalMethod(...args);
        }
      }

      const controller = new TestController();
      const req = { params: { entityId: TEST_IDS.entityId } };
      const otherArg = { something: "else" };

      const result = await controller.testMethod(req, otherArg);

      expect(result).toBe("success");
      expect(originalMethod).toHaveBeenCalledTimes(1);
    });

    it("should allow when bodyId is undefined in body.data", async () => {
      const originalMethod = vi.fn().mockResolvedValue("success");

      class TestController {
        @ValidateId("entityId")
        async testMethod(...args: any[]) {
          return originalMethod(...args);
        }
      }

      const controller = new TestController();
      const req = { params: { entityId: TEST_IDS.entityId } };
      const body = { data: { type: "test-entities" } };

      const result = await controller.testMethod(req, body);

      expect(result).toBe("success");
      expect(originalMethod).toHaveBeenCalledTimes(1);
    });

    it("should allow when both IDs are missing", async () => {
      const originalMethod = vi.fn().mockResolvedValue("success");

      class TestController {
        @ValidateId("entityId")
        async testMethod(...args: any[]) {
          return originalMethod(...args);
        }
      }

      const controller = new TestController();

      const result = await controller.testMethod();

      expect(result).toBe("success");
      expect(originalMethod).toHaveBeenCalledTimes(1);
    });
  });

  describe("custom bodyPath", () => {
    it("should work with custom bodyPath", async () => {
      const originalMethod = vi.fn().mockResolvedValue("success");

      // Custom bodyPath "data.attributes.resourceId" - body still needs "data" property to be found
      class TestController {
        @ValidateId("entityId", "data.attributes.resourceId")
        async testMethod(...args: any[]) {
          return originalMethod(...args);
        }
      }

      const controller = new TestController();
      const req = { params: { entityId: TEST_IDS.entityId } };
      const body = { data: { attributes: { resourceId: TEST_IDS.entityId } } };

      const result = await controller.testMethod(req, body);

      expect(result).toBe("success");
      expect(originalMethod).toHaveBeenCalledTimes(1);
    });

    it("should throw with custom bodyPath when IDs do not match", async () => {
      const originalMethod = vi.fn().mockResolvedValue("success");

      class TestController {
        @ValidateId("entityId", "data.attributes.resourceId")
        async testMethod(...args: any[]) {
          return originalMethod(...args);
        }
      }

      const controller = new TestController();
      const req = { params: { entityId: TEST_IDS.entityId } };
      const body = { data: { attributes: { resourceId: TEST_IDS.differentId } } };

      await expect(controller.testMethod(req, body)).rejects.toThrow(PreconditionFailedException);
      expect(originalMethod).not.toHaveBeenCalled();
    });

    it("should allow when custom bodyPath does not resolve (undefined path)", async () => {
      const originalMethod = vi.fn().mockResolvedValue("success");

      class TestController {
        @ValidateId("entityId", "nonexistent.path.id")
        async testMethod(...args: any[]) {
          return originalMethod(...args);
        }
      }

      const controller = new TestController();
      const req = { params: { entityId: TEST_IDS.entityId } };
      const body = { data: { id: TEST_IDS.differentId } };

      const result = await controller.testMethod(req, body);

      expect(result).toBe("success");
      expect(originalMethod).toHaveBeenCalledTimes(1);
    });
  });

  describe("method execution", () => {
    it("should pass all arguments to the original method", async () => {
      const originalMethod = vi.fn().mockResolvedValue("success");

      class TestController {
        @ValidateId("entityId")
        async testMethod(...args: any[]) {
          return originalMethod(...args);
        }
      }

      const controller = new TestController();
      const req = { params: { entityId: TEST_IDS.entityId } };
      const body = { data: { id: TEST_IDS.entityId } };
      const extra = { extra: "arg" };

      await controller.testMethod(req, body, extra);

      expect(originalMethod).toHaveBeenCalledWith(req, body, extra);
    });

    it("should preserve the return value of the original method", async () => {
      class TestController {
        @ValidateId("entityId")
        async testMethod(...args: any[]) {
          return { status: "created", id: args[1]?.data?.id };
        }
      }

      const controller = new TestController();
      const req = { params: { entityId: TEST_IDS.entityId } };
      const body = { data: { id: TEST_IDS.entityId } };

      const result = await controller.testMethod(req, body);

      expect(result).toEqual({ status: "created", id: TEST_IDS.entityId });
    });

    it("should work with async methods that throw errors", async () => {
      class TestController {
        @ValidateId("entityId")
        async testMethod(...args: any[]) {
          throw new Error("Original method error");
        }
      }

      const controller = new TestController();
      const req = { params: { entityId: TEST_IDS.entityId } };
      const body = { data: { id: TEST_IDS.entityId } };

      await expect(controller.testMethod(req, body)).rejects.toThrow("Original method error");
    });

    it("should preserve this context", async () => {
      class TestController {
        private value = "controller value";

        @ValidateId("entityId")
        async testMethod(...args: any[]) {
          return this.value;
        }
      }

      const controller = new TestController();
      const req = { params: { entityId: TEST_IDS.entityId } };
      const body = { data: { id: TEST_IDS.entityId } };

      const result = await controller.testMethod(req, body);

      expect(result).toBe("controller value");
    });
  });
});
