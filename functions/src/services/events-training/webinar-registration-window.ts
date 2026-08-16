/**
 * Shared registration-open + live join window helpers for webinars.
 */

const DEFAULT_WEBINAR_DURATION_MS = 2 * 60 * 60 * 1000;
/** Allow join 30 minutes before startsAt (guest + member live window). */
export const WEBINAR_JOIN_EARLY_MS = 30 * 60 * 1000;

export function toIsoTimestamp(value: unknown): string | null {
  if (!value) return null;
  if (typeof value === "string") {
    const d = new Date(value);
    return Number.isNaN(d.getTime()) ? null : d.toISOString();
  }
  if (
    typeof value === "object" &&
    value !== null &&
    "toDate" in value &&
    typeof (value as { toDate?: unknown }).toDate === "function"
  ) {
    try {
      return (value as { toDate: () => Date }).toDate().toISOString();
    } catch {
      return null;
    }
  }
  return null;
}

function parseTime(iso: string | null): number | null {
  if (!iso) return null;
  const t = Date.parse(iso);
  return Number.isNaN(t) ? null : t;
}

/**
 * Null / missing `registrationOpensAt` → open as soon as published.
 * Future timestamp → closed until that time.
 */
export function isRegistrationOpen(
  eventData: Record<string, unknown>,
  nowMs: number = Date.now(),
): boolean {
  const opensAt = toIsoTimestamp(eventData.registrationOpensAt);
  if (!opensAt) return true;
  const openMs = parseTime(opensAt);
  if (openMs == null) return true;
  return nowMs >= openMs;
}

export function assertRegistrationOpen(
  eventData: Record<string, unknown>,
  nowMs: number = Date.now(),
): void {
  if (isRegistrationOpen(eventData, nowMs)) return;
  const opensAt = toIsoTimestamp(eventData.registrationOpensAt);
  throw Object.assign(
    new Error(
      opensAt ?
        `Registration opens at ${opensAt}. Please try again later.` :
        "Registration is not open yet.",
    ),
    { status: 409, code: "REGISTRATION_NOT_OPEN", opensAt },
  );
}

/** Join window: [startsAt − 30m, endsAt) with default 2h duration. */
export function isWebinarJoinWindowOpen(
  startsAt: string | null,
  endsAt: string | null,
  nowMs: number = Date.now(),
): boolean {
  const start = parseTime(startsAt);
  if (start == null) return false;
  const end = parseTime(endsAt) ?? start + DEFAULT_WEBINAR_DURATION_MS;
  return nowMs >= start - WEBINAR_JOIN_EARLY_MS && nowMs < end;
}
