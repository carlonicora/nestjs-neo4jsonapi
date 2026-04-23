import { ACTION_ORDER, Action, PermToken } from "./types";

/**
 * Serialise a PermToken[] to the JSON-string shape stored on
 * `Module.permissions` and `HAS_PERMISSIONS.permissions` edges.
 *
 * Format: a JSON-stringified array of `{ type: Action, value: boolean | string }`
 * in fixed action order (read, create, update, delete).
 *
 * Merge rule within the input: unconditional `true` beats scoped path string;
 * scoped path string beats default `false`. (Matches auth.repository merge.)
 */
export function toPermissionsJson(tokens: PermToken[]): string {
  const perAction: Record<Action, boolean | string> = {
    read: false,
    create: false,
    update: false,
    delete: false,
  };

  for (const token of tokens) {
    const existing = perAction[token.action];
    const incoming = token.scope;

    // Precedence: true > string > false
    if (existing === true) continue;
    if (incoming === true) {
      perAction[token.action] = true;
      continue;
    }
    if (typeof existing === "string") continue; // keep earlier string
    if (typeof incoming === "string") {
      perAction[token.action] = incoming;
      continue;
    }
    // both false — no change
  }

  const array = ACTION_ORDER.map((action) => ({ type: action, value: perAction[action] }));
  return JSON.stringify(array);
}
