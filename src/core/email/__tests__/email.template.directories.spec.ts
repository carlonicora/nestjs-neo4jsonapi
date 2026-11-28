import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { mkdirSync, mkdtempSync, rmSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import {
  clearRegisteredEmailTemplateDirectories,
  getRegisteredEmailTemplateDirectories,
  registerEmailTemplateDirectory,
} from "../email.template.directories";

describe("registerEmailTemplateDirectory", () => {
  let root: string;

  beforeEach(() => {
    root = mkdtempSync(join(tmpdir(), "email-dirs-"));
    clearRegisteredEmailTemplateDirectories();
  });

  afterEach(() => {
    clearRegisteredEmailTemplateDirectories();
    rmSync(root, { recursive: true, force: true });
  });

  it("keeps registered folders in registration order", () => {
    mkdirSync(join(root, "a"));
    mkdirSync(join(root, "b"));

    registerEmailTemplateDirectory(join(root, "a"));
    registerEmailTemplateDirectory(join(root, "b"));

    expect(getRegisteredEmailTemplateDirectories()).toEqual([join(root, "a"), join(root, "b")]);
  });

  it("ignores a folder registered twice", () => {
    mkdirSync(join(root, "a"));

    registerEmailTemplateDirectory(join(root, "a"));
    registerEmailTemplateDirectory(join(root, "a", "."));

    expect(getRegisteredEmailTemplateDirectories()).toEqual([join(root, "a")]);
  });

  it("refuses a relative path", () => {
    expect(() => registerEmailTemplateDirectory("templates/email")).toThrow(
      'registerEmailTemplateDirectory needs an absolute path, got "templates/email"',
    );
  });

  it("refuses a folder that does not exist", () => {
    expect(() => registerEmailTemplateDirectory(join(root, "missing"))).toThrow(
      `registerEmailTemplateDirectory: folder "${join(root, "missing")}" does not exist`,
    );
  });
});
