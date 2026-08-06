/**
 * Shared guest-eligibility helpers for webinar events.
 */

export function normalizeWebinarVisibility(raw: unknown): string {
  const v = String(raw ?? "private");
  if (v === "members" || v === "subscription") return "private";
  return v;
}

/**
 * CMS may set `guestRegistrationEnabled: false` to block guests on a public event.
 * Missing / true → guests allowed for **public**.
 * For **premium**, guests (pay) are allowed only when explicitly `true`.
 */
export function isCmsGuestRegistrationAllowed(eventData: Record<string, unknown>): boolean {
  const visibility = normalizeWebinarVisibility(eventData.visibility);
  if (visibility === "private") return false;
  if (visibility === "premium") {
    return eventData.guestRegistrationEnabled === true;
  }
  return eventData.guestRegistrationEnabled !== false;
}
