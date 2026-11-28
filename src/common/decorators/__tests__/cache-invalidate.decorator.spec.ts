import { Body, Delete, Param, Patch, Post, Req, Request, RequestMethod, Res } from "@nestjs/common";
import { METHOD_METADATA, PATH_METADATA } from "@nestjs/common/constants";
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

  describe("elements option", () => {
    type El = { type: string; id: string };
    let cacheService: {
      invalidateByElement: ReturnType<typeof vi.fn>;
      invalidateByType: ReturnType<typeof vi.fn>;
      invalidateByElements: ReturnType<typeof vi.fn>;
    };
    let linked: El[];
    let elements: Mock<(context: { controller: any; request: any }) => Promise<El[]>>;

    beforeEach(() => {
      cacheService = { invalidateByElement: vi.fn(), invalidateByType: vi.fn(), invalidateByElements: vi.fn() };
      linked = [{ type: "projects", id: "p1" }];
      elements = vi.fn(async () => [...linked]);
    });

    const build = () => {
      class TestController {
        constructor(public cacheService: any) {}

        @Patch("tests/:entityId")
        @CacheInvalidate(meta, "entityId", { elements: (context) => elements(context) })
        async update(@Req() _req: any, @Res() _reply: any) {
          // The write unlinks p1 and links p2.
          linked = [{ type: "projects", id: "p2" }];
          return "ok";
        }

        @Post("tests")
        @CacheInvalidate(meta, undefined, { elements: (context) => elements(context) })
        async create(@Req() _req: any, @Res() _reply: any) {
          return "created";
        }
      }
      return TestController;
    };

    it("invalidates the union of the elements before and after the write", async () => {
      const Controller = build();
      const controller = new Controller(cacheService);
      const req = { params: { entityId: "e-1" } };

      await expect(controller.update(req, {})).resolves.toBe("ok");

      expect(elements).toHaveBeenCalledTimes(2);
      expect(elements).toHaveBeenCalledWith({ controller, request: req });
      expect(cacheService.invalidateByElement).toHaveBeenCalledWith("tests", "e-1");
      expect(cacheService.invalidateByElements).toHaveBeenCalledWith([
        { type: "projects", id: "p1" },
        { type: "projects", id: "p2" },
      ]);
    });

    it("lists an element reported twice once", async () => {
      const Controller = build();
      const controller = new Controller(cacheService);
      linked = [{ type: "projects", id: "p2" }];

      await controller.update({ params: { entityId: "e-1" } }, {});

      expect(cacheService.invalidateByElements).toHaveBeenCalledWith([{ type: "projects", id: "p2" }]);
    });

    it("works without an id and still invalidates by type", async () => {
      const Controller = build();
      const controller = new Controller(cacheService);

      await controller.create({ params: {} }, {});

      expect(cacheService.invalidateByType).toHaveBeenCalledWith("tests");
      expect(cacheService.invalidateByElements).toHaveBeenCalledWith([{ type: "projects", id: "p1" }]);
    });

    it("skips invalidateByElements when no element is reported", async () => {
      const Controller = build();
      const controller = new Controller(cacheService);
      elements.mockResolvedValue([]);

      await controller.create({ params: {} }, {});

      expect(cacheService.invalidateByElements).not.toHaveBeenCalled();
    });

    it("needs @Req() even without an id", () => {
      expect(() => {
        class TestController {
          @CacheInvalidate(meta, undefined, { elements: () => [] })
          async create(@Res() _reply: any, @Body() _body: any) {}
        }
        return TestController;
      }).toThrow("needs the request");
    });

    it("does not run the handler when the elements read before it fails", async () => {
      const Controller = build();
      const controller = new Controller(cacheService);
      elements.mockRejectedValueOnce(new Error("read failed"));

      await expect(controller.update({ params: { entityId: "e-1" } }, {})).rejects.toThrow("read failed");
      // The handler would have changed the links: it never ran.
      expect(linked).toEqual([{ type: "projects", id: "p1" }]);
      expect(cacheService.invalidateByElement).not.toHaveBeenCalled();
    });
  });

  it.each([
    ["with an id", "entityId"],
    ["without an id", undefined],
  ])("keeps the route metadata of a route decorator listed below it (%s)", (_label, id) => {
    class TestController {
      @CacheInvalidate(meta, id)
      @Delete("tests/:entityId")
      async remove(@Req() _req: any) {}
    }

    const handler = TestController.prototype.remove;
    expect(Reflect.getMetadata(PATH_METADATA, handler)).toBe("tests/:entityId");
    expect(Reflect.getMetadata(METHOD_METADATA, handler)).toBe(RequestMethod.DELETE);
  });
});
