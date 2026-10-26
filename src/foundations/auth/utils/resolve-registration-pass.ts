import { ModuleRef } from "@nestjs/core";
import { REGISTRATION_PASS, RegistrationPassInterface } from "../interfaces/registration-pass.interface";

/**
 * Resolves the optional application-provided registration pass hook.
 * Call at use time, never in a constructor (moduleRef.get in a constructor can capture a placeholder).
 *
 * @returns The hook, or undefined when the application provides none
 */
export function resolveRegistrationPass(moduleRef: ModuleRef): RegistrationPassInterface | undefined {
  try {
    return moduleRef.get(REGISTRATION_PASS, { strict: false });
  } catch {
    return undefined;
  }
}
