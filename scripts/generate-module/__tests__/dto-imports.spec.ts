import { describe, it, expect } from "vitest";
import { pruneClassValidatorImports } from "../utils/dto-imports";

describe("pruneClassValidatorImports", () => {
  it("drops validators that are imported but never used as decorators", () => {
    const content = [
      `import { Type } from "class-transformer";`,
      `import { Equals, IsDefined, IsNotEmpty, IsNumber, IsOptional, IsUUID, ValidateNested } from "class-validator";`,
      ``,
      `export class FooDTO {`,
      `  @Equals("foos") type: string;`,
      `  @IsUUID() id: string;`,
      `  @IsDefined() @IsNotEmpty() @IsNumber() number: number;`,
      `  @ValidateNested() @Type(() => Object) data: object;`,
      `}`,
    ].join("\n");

    const out = pruneClassValidatorImports(content);
    // IsOptional is unused → removed; everything else is kept.
    expect(out).toContain(
      `import { Equals, IsDefined, IsNotEmpty, IsNumber, IsUUID, ValidateNested } from "class-validator";`,
    );
    expect(out).not.toContain("IsOptional");
  });

  it("keeps validators that are used", () => {
    const content = [
      `import { IsOptional, IsString } from "class-validator";`,
      `export class BarDTO {`,
      `  @IsOptional() @IsString() name?: string;`,
      `}`,
    ].join("\n");
    const out = pruneClassValidatorImports(content);
    expect(out).toContain(`import { IsOptional, IsString } from "class-validator";`);
  });

  it("is a no-op when there is no class-validator import", () => {
    const content = `export const x = 1;\n`;
    expect(pruneClassValidatorImports(content)).toBe(content);
  });
});
