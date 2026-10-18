import { readdirSync, readFileSync } from "fs";
import { join, relative, sep } from "path";
import ts from "typescript";
import { describe, expect, it } from "vitest";

/**
 * Guards the document return-type contract.
 *
 * `JsonApiService.buildSingle` / `buildList` return `Promise<any>`, so `tsc`
 * cannot tell a method declared `Promise<JsonApiSingleDocument>` that returns a
 * list document (or the reverse). This spec reads every source file and checks
 * the declared type against the builder each returned value comes from: the
 * builder call itself, or the variable it was assigned to. A method may still
 * call the other builder for something it does not return (for example, to fill
 * `included`).
 */
const SRC_ROOT = join(__dirname, "..", "..", "..", "..");

const isSpec = (path: string): boolean => /\.spec\.ts$/.test(path) || path.split(sep).includes("__tests__");

function walk(dir: string, out: string[] = []): string[] {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    if (entry.name === "node_modules" || entry.name.startsWith("dist")) continue;
    const full = join(dir, entry.name);
    if (entry.isDirectory()) walk(full, out);
    else if (entry.isFile() && entry.name.endsWith(".ts")) out.push(full);
  }
  return out;
}

const ALL_FILES = walk(SRC_ROOT);
const SOURCE_FILES = ALL_FILES.filter((path) => !isSpec(path));

type Mismatch = { location: string; declared: string; returns: string };

const unwrap = (node: ts.Expression): ts.Expression => {
  let current = node;
  while (
    ts.isAwaitExpression(current) ||
    ts.isParenthesizedExpression(current) ||
    ts.isAsExpression(current) ||
    ts.isNonNullExpression(current)
  )
    current = current.expression;
  return current;
};

/** The builder (`buildSingle` / `buildList`) a returned expression comes from, one variable deep. */
function builderOf(expression: ts.Expression, body: ts.Node): string | undefined {
  const node = unwrap(expression);
  if (ts.isConditionalExpression(node)) return builderOf(node.whenTrue, body) ?? builderOf(node.whenFalse, body);
  if (ts.isCallExpression(node) && ts.isPropertyAccessExpression(node.expression)) {
    const name = node.expression.name.text;
    return name === "buildSingle" || name === "buildList" ? name : undefined;
  }
  if (ts.isIdentifier(node)) {
    let found: string | undefined;
    const visit = (child: ts.Node): void => {
      if (found) return;
      if (ts.isVariableDeclaration(child) && ts.isIdentifier(child.name) && child.name.text === node.text) {
        if (child.initializer) found = builderOf(child.initializer, body);
        return;
      }
      ts.forEachChild(child, visit);
    };
    visit(body);
    return found;
  }
  return undefined;
}

/** Every `return` expression of a function body, not counting nested functions. */
function returnedExpressions(body: ts.Node): ts.Expression[] {
  if (!ts.isBlock(body)) return [body as ts.Expression];
  const found: ts.Expression[] = [];
  const visit = (node: ts.Node): void => {
    if (ts.isFunctionLike(node)) return;
    if (ts.isReturnStatement(node) && node.expression) found.push(node.expression);
    ts.forEachChild(node, visit);
  };
  ts.forEachChild(body, visit);
  return found;
}

function findMismatches(): Mismatch[] {
  const mismatches: Mismatch[] = [];
  for (const file of SOURCE_FILES) {
    const text = readFileSync(file, "utf8");
    if (!text.includes("JsonApiSingleDocument") && !text.includes("JsonApiListDocument")) continue;
    const source = ts.createSourceFile(file, text, ts.ScriptTarget.Latest, true);
    const visit = (node: ts.Node): void => {
      if (ts.isFunctionLike(node) && node.type && "body" in node && node.body) {
        const declared = node.type.getText(source);
        const forbidden = declared.startsWith("Promise<JsonApiSingleDocument")
          ? "buildList"
          : declared.startsWith("Promise<JsonApiListDocument")
            ? "buildSingle"
            : undefined;
        const body = node.body as ts.Node;
        if (forbidden && returnedExpressions(body).some((expression) => builderOf(expression, body) === forbidden)) {
          const { line } = source.getLineAndCharacterOfPosition(node.getStart(source));
          mismatches.push({ location: `${relative(SRC_ROOT, file)}:${line + 1}`, declared, returns: forbidden });
        }
      }
      ts.forEachChild(node, visit);
    };
    visit(source);
  }
  return mismatches;
}

describe("JSON:API document return types", () => {
  it("never declares a single document where the method returns a built list, or the reverse", () => {
    expect(findMismatches()).toEqual([]);
  });

  it("declares no method as returning the serialiser builder shape", () => {
    // Built from two halves so this file does not match itself.
    const needle = "Promise<" + "JsonApiDataInterface";
    const hits: string[] = [];
    for (const file of ALL_FILES) {
      readFileSync(file, "utf8")
        .split("\n")
        .forEach((line, index) => {
          if (line.includes(needle)) hits.push(`${relative(SRC_ROOT, file)}:${index + 1}`);
        });
    }
    expect(hits).toEqual([]);
  });
});
