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
 * Missing / true → guests allowed (subject to public + published + seats).
 */
export function isCmsGuestRegistrationAllowed(eventData: Record<string, unknown>): boolean {
  return eventData.guestRegistrationEnabled !== false;
}
