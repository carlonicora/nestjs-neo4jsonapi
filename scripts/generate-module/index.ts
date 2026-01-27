#!/usr/bin/env node

import { Command } from "commander";
import * as path from "path";
import { generateModule } from "./generator";

const program = new Command();

program
  .name("generate-module")
  .description("Generate a NestJS module from a JSON schema definition")
  .version("1.0.0")
  .argument("<json-file>", "Path to JSON schema file")
  .option("--dry-run", "Preview files without writing them", false)
  .option("--force", "Overwrite existing files", false)
  .option("--no-register", "Skip module registration in parent module", false)
  .action(async (jsonFile: string, options) => {
    try {
      const jsonPath = path.resolve(process.cwd(), jsonFile);

      console.info(`\n🚀 NestJS Module Generator\n`);
      console.info(`   JSON File: ${jsonPath}`);
      console.info(`   Dry Run: ${options.dryRun ? "Yes" : "No"}`);
      console.info(`   Force: ${options.force ? "Yes" : "No"}`);
      console.info(`   Register: ${options.register ? "Yes" : "No"}\n`);

      await generateModule({
        jsonPath,
        dryRun: options.dryRun,
        force: options.force,
        noRegister: !options.register,
      });
    } catch (error: any) {
      console.error(`\n❌ Error: ${error.message}\n`);
      process.exit(1);
    }
  });

program.parse(process.argv);
