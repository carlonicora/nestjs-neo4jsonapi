import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { TestingModule, Test } from "@nestjs/testing";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "fs";
import { I18nJsonLoader, I18nModule, I18nService } from "nestjs-i18n";
import { tmpdir } from "os";
import { join } from "path";
import {
  buildI18nLoaders,
  clearRegisteredI18nDirectories,
  getRegisteredI18nDirectories,
  registerI18nDirectory,
} from "../i18n.directories";

const writeJson = (dir: string, locale: string, ns: string, data: Record<string, unknown>): void => {
  mkdirSync(join(dir, locale), { recursive: true });
  writeFileSync(join(dir, locale, `${ns}.json`), JSON.stringify(data));
};

describe("registerI18nDirectory", () => {
  let root: string;

  beforeEach(() => {
    root = mkdtempSync(join(tmpdir(), "i18n-dirs-"));
    clearRegisteredI18nDirectories();
  });

  afterEach(() => {
    clearRegisteredI18nDirectories();
    rmSync(root, { recursive: true, force: true });
  });

  it("keeps registered folders in registration order", () => {
    mkdirSync(join(root, "a"));
    mkdirSync(join(root, "b"));

    registerI18nDirectory(join(root, "a"));
    registerI18nDirectory(join(root, "b"));

    expect(getRegisteredI18nDirectories()).toEqual([join(root, "a"), join(root, "b")]);
  });

  it("ignores a folder registered twice", () => {
    mkdirSync(join(root, "a"));

    registerI18nDirectory(join(root, "a"));
    registerI18nDirectory(join(root, "a", "."));

    expect(getRegisteredI18nDirectories()).toEqual([join(root, "a")]);
  });

  it("refuses a relative path", () => {
    expect(() => registerI18nDirectory("templates/email")).toThrow(
      'registerI18nDirectory needs an absolute path, got "templates/email"',
    );
  });

  it("refuses a folder that does not exist", () => {
    expect(() => registerI18nDirectory(join(root, "missing"))).toThrow(
      `registerI18nDirectory: folder "${join(root, "missing")}" does not exist`,
    );
  });

  it("builds one loader per registered folder plus the app's", () => {
    mkdirSync(join(root, "a"));
    mkdirSync(join(root, "b"));
    mkdirSync(join(root, "app", "en"), { recursive: true });
    registerI18nDirectory(join(root, "a"));
    registerI18nDirectory(join(root, "b"));

    const loaders = buildI18nLoaders({ appPath: join(root, "app"), watch: false });

    expect(loaders).toHaveLength(3);
    for (const loader of loaders) expect(loader).toBeInstanceOf(I18nJsonLoader);
  });

  it("refuses a registration after the loaders were built", () => {
    mkdirSync(join(root, "app", "en"), { recursive: true });
    mkdirSync(join(root, "late"));
    buildI18nLoaders({ appPath: join(root, "app"), watch: false });

    expect(() => registerI18nDirectory(join(root, "late"))).toThrow(
      `registerI18nDirectory("${join(root, "late")}") ran after the i18n module was built. Call it inside a module's static forRoot that the app imports before bootstrap() runs.`,
    );
  });

  describe("merged translations", () => {
    let moduleRef: TestingModule | undefined;
    let appPath: string;
    let pkgA: string;
    let pkgB: string;

    beforeEach(() => {
      appPath = join(root, "app");
      pkgA = join(root, "a");
      pkgB = join(root, "b");
      writeJson(appPath, "en", "todos", { title: "App title" });
      writeJson(pkgA, "en", "todos", { title: "Package A title", subject: "Package A subject", shared: "A" });
      writeJson(pkgB, "en", "todos", { shared: "B", onlyB: "Package B" });
      writeJson(pkgB, "en", "other", { hello: "Hello from B" });
      registerI18nDirectory(pkgA);
      registerI18nDirectory(pkgB);
    });

    afterEach(async () => {
      await moduleRef?.close();
      moduleRef = undefined;
    });

    const build = async (): Promise<I18nService> => {
      moduleRef = await Test.createTestingModule({
        imports: [
          I18nModule.forRoot({
            fallbackLanguage: "en",
            logging: false,
            loaders: buildI18nLoaders({ appPath, watch: false }),
          }),
        ],
      }).compile();
      return moduleRef.get(I18nService);
    };

    it("the app's key wins over a package's", async () => {
      const i18n = await build();
      expect(i18n.t("todos.title", { lang: "en" })).toBe("App title");
    });

    it("a key only a package has is available", async () => {
      const i18n = await build();
      expect(i18n.t("todos.subject", { lang: "en" })).toBe("Package A subject");
      expect(i18n.t("todos.onlyB", { lang: "en" })).toBe("Package B");
    });

    it("the first registered package wins over a later one", async () => {
      const i18n = await build();
      expect(i18n.t("todos.shared", { lang: "en" })).toBe("A");
    });

    it("a namespace only a package has is available", async () => {
      const i18n = await build();
      expect(i18n.t("other.hello", { lang: "en" })).toBe("Hello from B");
    });
  });
});
