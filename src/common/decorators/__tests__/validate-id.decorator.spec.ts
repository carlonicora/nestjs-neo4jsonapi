import { describe, it, expect, vi, beforeEach } from "vitest";
import { Body, Patch, PreconditionFailedException, Req, Request, Res } from "@nestjs/common";
import { Audit } from "../audit.decorator";
import { Roles } from "../roles.decorator";
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
        async testMethod(@Req() ...args: any[]) {
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
        async testMethod(@Req() ...args: any[]) {
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

    it("should throw when the request does not reach the handler at runtime", async () => {
      const originalMethod = vi.fn().mockResolvedValue("success");

      class TestController {
        @ValidateId("entityId")
        async testMethod(@Req() ...args: any[]) {
          return originalMethod(...args);
        }
      }

      const controller = new TestController();
      const body = { data: { id: TEST_IDS.entityId } };

      await expect(controller.testMethod(body)).rejects.toThrow(
        '@ValidateId("entityId") on TestController.testMethod did not receive the request',
      );
      expect(originalMethod).not.toHaveBeenCalled();
    });

    it("should allow when paramId is undefined in params", async () => {
      const originalMethod = vi.fn().mockResolvedValue("success");

      class TestController {
        @ValidateId("entityId")
        async testMethod(@Req() ...args: any[]) {
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
        async testMethod(@Req() ...args: any[]) {
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
        async testMethod(@Req() ...args: any[]) {
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
        async testMethod(@Req() ...args: any[]) {
          return originalMethod(...args);
        }
      }

      const controller = new TestController();

      const result = await controller.testMethod({ params: {} });

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
        async testMethod(@Req() ...args: any[]) {
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
        async testMethod(@Req() ...args: any[]) {
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
        async testMethod(@Req() ...args: any[]) {
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
        async testMethod(@Req() ...args: any[]) {
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
        async testMethod(@Req() ...args: any[]) {
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
        async testMethod(@Req() ...args: any[]) {
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
        async testMethod(@Req() ...args: any[]) {
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
  describe("definition-time check", () => {
    it("throws when the handler does not declare @Req()", () => {
      expect(() => {
        class StripeCouponController {
          @ValidateId("couponId")
          async rename(@Res() reply: any, @Body() body: any) {
            return { reply, body };
          }
        }
        return StripeCouponController;
      }).toThrow(
        '@ValidateId("couponId") on StripeCouponController.rename needs the request: add @Req() to its parameters',
      );
    });

    it("throws when the handler has no decorated parameters at all", () => {
      expect(() => {
        class TestController {
          @ValidateId("entityId")
          async testMethod(_req: any, _body: any) {
            return "success";
          }
        }
        return TestController;
      }).toThrow("needs the request");
    });

    it.each([0, 1, 2])("accepts @Req() at parameter %i", (position) => {
      expect(() => {
        if (position === 0) {
          class A {
            @ValidateId("entityId")
            async m(@Req() _req: any, @Res() _reply: any, @Body() _body: any) {}
          }
          return A;
        }
        if (position === 1) {
          class B {
            @ValidateId("entityId")
            async m(@Res() _reply: any, @Req() _req: any, @Body() _body: any) {}
          }
          return B;
        }
        class C {
          @ValidateId("entityId")
          async m(@Res() _reply: any, @Body() _body: any, @Req() _req: any) {}
        }
        return C;
      }).not.toThrow();
    });

    it("accepts @Request(), Nest's alias of @Req()", () => {
      expect(() => {
        class UserController {
          @ValidateId("userId")
          async put(@Request() _request: any, @Res() _reply: any, @Body() _body: any) {}
        }
        return UserController;
      }).not.toThrow();
    });

    it("sees @Req() whatever the order of the other method decorators", () => {
      const meta = { type: "tests", endpoint: "tests", nodeName: "test", labelName: "Test" };
      expect(() => {
        class Above {
          @Patch("tests/:entityId")
          @Roles("admin")
          @Audit(meta, "entityId")
          @ValidateId("entityId")
          async m(@Req() _req: any, @Body() _body: any) {}
        }
        class Below {
          @ValidateId("entityId")
          @Audit(meta, "entityId")
          @Roles("admin")
          @Patch("tests/:entityId")
          async m(@Req() _req: any, @Body() _body: any) {}
        }
        class Middle {
          @Roles("admin")
          @ValidateId("entityId")
          @Patch("tests/:entityId")
          async m(@Body() _body: any, @Req() _req: any) {}
        }
        return [Above, Below, Middle];
      }).not.toThrow();

      expect(() => {
        class Below {
          @ValidateId("entityId")
          @Audit(meta, "entityId")
          @Roles("admin")
          @Patch("tests/:entityId")
          async m(@Body() _body: any) {}
        }
        return Below;
      }).toThrow("needs the request");
    });

    it("refuses a mismatch on a real handler shape with @Req() after @Res()", async () => {
      const update = vi.fn().mockResolvedValue("ok");
      class TestController {
        @Patch("tests/:entityId")
        @ValidateId("entityId")
        async m(@Res() _reply: any, @Req() _req: any, @Body() body: any) {
          return update(body);
        }
      }
      const controller = new TestController();
      const reply = { send: vi.fn() };

      await expect(
        controller.m(reply, { params: { entityId: TEST_IDS.entityId } }, { data: { id: TEST_IDS.differentId } }),
      ).rejects.toThrow(PreconditionFailedException);
      expect(update).not.toHaveBeenCalled();

      await expect(
        controller.m(reply, { params: { entityId: TEST_IDS.entityId } }, { data: { id: TEST_IDS.entityId } }),
      ).resolves.toBe("ok");
    });
  });
});
