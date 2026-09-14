import { MODULE_METADATA } from "@nestjs/common/constants";
import { describe, expect, it } from "vitest";
import { HowToController } from "../controllers/how-to.controller";
import { HowToPublicController } from "../controllers/how-to.public.controller";
import { HowToModule } from "../how-to.module";
import { DEFAULT_HOW_TO_CONFIG } from "../interfaces/how-to.config.interface";

/**
 * Nest resolves a module's controllers by CONCATENATING the `@Module()`
 * decorator metadata with the dynamic metadata returned by `forRoot()`
 * (scanner.ts, `reflectMetadata(...CONTROLLERS) + getDynamicMetadataByToken(...)`),
 * so the effective surface is the union of the two. These tests reflect both
 * rather than booting an app: the question is purely which controller classes a
 * consumer ends up mounting.
 */
const staticControllers = (): any[] => Reflect.getMetadata(MODULE_METADATA.CONTROLLERS, HowToModule) ?? [];

const effectiveControllers = (dynamicControllers: any[] = []): any[] => [...staticControllers(), ...dynamicControllers];

describe("HowToModule public routes", () => {
  describe("static import (no forRoot)", () => {
    it("mounts the authenticated controller", () => {
      expect(staticControllers()).toContain(HowToController);
    });

    it("does NOT mount HowToPublicController", () => {
      expect(staticControllers()).not.toContain(HowToPublicController);
    });
  });

  describe("forRoot() with no arguments", () => {
    it("does NOT mount HowToPublicController", () => {
      const module = HowToModule.forRoot();

      expect(effectiveControllers(module.controllers)).not.toContain(HowToPublicController);
    });

    it("still mounts the authenticated controller and adds nothing else", () => {
      const module = HowToModule.forRoot();

      expect(module.controllers ?? []).toEqual([]);
      expect(effectiveControllers(module.controllers)).toEqual(staticControllers());
    });

    it("defaults publicRoutes to false", () => {
      expect(DEFAULT_HOW_TO_CONFIG).toEqual({ publicRoutes: false });
    });
  });

  describe("forRoot({ publicRoutes: false })", () => {
    it("does NOT mount HowToPublicController", () => {
      const module = HowToModule.forRoot({ publicRoutes: false });

      expect(effectiveControllers(module.controllers)).not.toContain(HowToPublicController);
    });
  });

  describe("forRoot({ publicRoutes: true })", () => {
    it("mounts HowToPublicController", () => {
      const module = HowToModule.forRoot({ publicRoutes: true });

      expect(module.controllers).toContain(HowToPublicController);
      expect(effectiveControllers(module.controllers)).toContain(HowToPublicController);
    });

    it("keeps the authenticated controller alongside it", () => {
      const module = HowToModule.forRoot({ publicRoutes: true });

      expect(effectiveControllers(module.controllers)).toContain(HowToController);
    });

    it("returns a DynamicModule bound to HowToModule", () => {
      expect(HowToModule.forRoot({ publicRoutes: true }).module).toBe(HowToModule);
    });
  });
});
