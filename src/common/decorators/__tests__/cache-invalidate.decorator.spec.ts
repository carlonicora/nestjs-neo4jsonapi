import { Body, Delete, Param, Patch, Post, Req, Request, Res } from "@nestjs/common";
import { beforeEach, describe, expect, it, vi, type Mock } from "vitest";
import { Audit } from "../audit.decorator";
import { CacheInvalidate } from "../cache-invalidate.decorator";
import { Roles } from "../roles.decorator";
import { ValidateId } from "../validate-id.decorator";

const meta = { type: "tests", endpoint: "tests", nodeName: "test", labelName: "Test" };

describe("CacheInvalidate decorator", () => {
  describe("definition-time check", () => {
    it("throws when the id variant is used on a handler without @Req()", () => {
      expect(() => {
        class StripeCouponController {
          @CacheInvalidate(meta, "couponId")
          async rename(@Res() reply: any, @Param("couponId") couponId: string) {
            return { reply, couponId };
          }
        }
        return StripeCouponController;
      }).toThrow(
        '@CacheInvalidate(meta, "couponId") on StripeCouponController.rename needs the request: add @Req() to its parameters',
      );
    });

    it("does not need @Req() without an id", () => {
      expect(() => {
        class TestController {
          @Post("tests")
          @CacheInvalidate(meta)
          async create(@Res() _reply: any, @Body() _body: any) {}
        }
        return TestController;
      }).not.toThrow();
    });

    it("does not read meta while the class is defined (circular imports can leave it undefined)", () => {
      expect(() => {
        class TestController {
          @CacheInvalidate(undefined as any, "entityId")
          async m(@Req() _req: any) {}
        }
        return TestController;
      }).not.toThrow();
    });

    it.each([0, 1, 2])("accepts @Req() at parameter %i", (position) => {
      expect(() => {
        if (position === 0) {
          class A {
            @CacheInvalidate(meta, "entityId")
            async m(@Req() _req: any, @Res() _reply: any, @Param("entityId") _id: string) {}
          }
          return A;
        }
        if (position === 1) {
          class B {
            @CacheInvalidate(meta, "entityId")
            async m(@Res() _reply: any, @Req() _req: any, @Param("entityId") _id: string) {}
          }
          return B;
        }
        class C {
          @CacheInvalidate(meta, "entityId")
          async m(@Res() _reply: any, @Param("entityId") _id: string, @Req() _req: any) {}
        }
        return C;
      }).not.toThrow();
    });

    it("sees @Req() whatever the order of the other method decorators", () => {
      expect(() => {
        class Above {
          @Patch("tests/:entityId")
          @Roles("admin")
          @Audit(meta, "entityId")
          @ValidateId("entityId")
          @CacheInvalidate(meta, "entityId")
          async m(@Req() _req: any, @Body() _body: any) {}
        }
        class Below {
          @CacheInvalidate(meta, "entityId")
          @ValidateId("entityId")
          @Audit(meta, "entityId")
          @Roles("admin")
          @Delete("tests/:entityId")
          async m(@Res() _reply: any, @Req() _req: any) {}
        }
        return [Above, Below];
      }).not.toThrow();

      expect(() => {
        class Below {
          @CacheInvalidate(meta, "entityId")
          @Roles("admin")
          @Patch("tests/:entityId")
          async m(@Res() _reply: any, @Body() _body: any) {}
        }
        return Below;
      }).toThrow("needs the request");
    });

    it("accepts @Request(), Nest's alias of @Req()", () => {
      expect(() => {
        class UserController {
          @CacheInvalidate(meta, "userId")
          async put(@Request() _request: any, @Res() _reply: any, @Body() _body: any) {}
        }
        return UserController;
      }).not.toThrow();
    });
  });

  describe("runtime", () => {
    let cacheService: { invalidateByElement: ReturnType<typeof vi.fn>; invalidateByType: ReturnType<typeof vi.fn> };
    let work: Mock<(...args: any[]) => Promise<unknown>>;

    class TestController {
      constructor(
        public cacheService: any,
        private readonly work: (...args: any[]) => Promise<unknown>,
      ) {}

      @Patch("tests/:entityId")
      @CacheInvalidate(meta, "entityId")
      async update(@Res() _reply: any, @Req() _req: any, @Body() body: any) {
        return this.work(body);
      }

      @Post("tests")
      @CacheInvalidate(meta)
      async create(@Res() _reply: any, @Body() body: any) {
        return this.work(body);
      }
    }

    beforeEach(() => {
      cacheService = { invalidateByElement: vi.fn(), invalidateByType: vi.fn() };
      work = vi.fn().mockResolvedValue("ok");
    });

    it("invalidates the element named by the route param", async () => {
      const controller = new TestController(cacheService, work);

      await expect(controller.update({}, { params: { entityId: "e-1" } }, { data: {} })).resolves.toBe("ok");

      expect(cacheService.invalidateByElement).toHaveBeenCalledWith("tests", "e-1");
      expect(cacheService.invalidateByType).not.toHaveBeenCalled();
    });

    it("invalidates by type without an id", async () => {
      const controller = new TestController(cacheService, work);

      await controller.create({}, { data: {} });

      expect(cacheService.invalidateByType).toHaveBeenCalledWith("tests");
      expect(cacheService.invalidateByElement).not.toHaveBeenCalled();
    });

    it("throws before the handler runs when the request does not arrive", async () => {
      const controller = new TestController(cacheService, work);

      await expect(controller.update({}, undefined, { data: {} })).rejects.toThrow(
        '@CacheInvalidate(meta, "entityId") on TestController.update did not receive the request',
      );
      expect(work).not.toHaveBeenCalled();
      expect(cacheService.invalidateByElement).not.toHaveBeenCalled();
    });

    it("skips invalidation when the param is absent from the request", async () => {
      const controller = new TestController(cacheService, work);

      await controller.update({}, { params: {} }, { data: {} });

      expect(cacheService.invalidateByElement).not.toHaveBeenCalled();
    });
  });
});
