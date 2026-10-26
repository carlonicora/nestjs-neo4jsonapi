/**
 * True when the address can receive email. Bot placeholder players carry a
 * fake `...@....local` address and Discord sign-ups without an email carry
 * their numeric Discord id: neither receives the deletion emails, and both
 * confirm with DELETE / ELIMINA instead of their address.
 */
export function hasDeliverableEmail(email: string | undefined | null): boolean {
  const value = email?.trim() ?? "";
  if (!value) return false;
  if (value.toLowerCase().endsWith(".local")) return false;
  if (/^\d+$/.test(value)) return false;
  return true;
}
