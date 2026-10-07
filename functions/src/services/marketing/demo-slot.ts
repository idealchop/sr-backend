import { manilaDateKey, PHILIPPINE_TIMEZONE } from "../../utils/philippine-datetime";
import {
  DEMO_DURATION_MINUTES,
  DEMO_START_HOUR_MANILA,
  DEMO_START_MINUTE_MANILA,
  DEMO_TIMEZONE,
} from "./demo-calendar-config";

export type DemoSlot = {
  dateKey: string;
  startsAt: Date;
  endsAt: Date;
  startsAtIso: string;
  endsAtIso: string;
  timezone: typeof DEMO_TIMEZONE;
  durationMinutes: typeof DEMO_DURATION_MINUTES;
  startHour: number;
  startMinute: number;
};

const ISO_DATE_RE = /^(\d{4})-(\d{2})-(\d{2})$/;
const TIME_RE = /^(\d{1,2}):(\d{2})$/;

/** PPP-like: "September 17th, 2026" or "September 17, 2026". */
const PPP_RE =
  /^([A-Za-z]+)\s+(\d{1,2})(?:st|nd|rd|th)?,?\s+(\d{4})$/;

const MONTH_INDEX: Record<string, number> = {
  january: 1,
  february: 2,
  march: 3,
  april: 4,
  may: 5,
  june: 6,
  july: 7,
  august: 8,
  september: 9,
  october: 10,
  november: 11,
  december: 12,
};

/**
 * Asia/Manila is UTC+8 year-round (no DST).
 * @param {number} year Full year.
 * @param {number} month 1–12.
 * @param {number} day Day of month.
 * @param {number} hour Hour 0–23 in Manila.
 * @param {number} minute Minute 0–59.
 * @return {Date} Instant for that Manila wall time.
 */
export function manilaWallTimeToUtc(
  year: number,
  month: number,
  day: number,
  hour: number,
  minute = 0,
): Date {
  return new Date(Date.UTC(year, month - 1, day, hour - 8, minute, 0, 0));
}

/**
 * @param {string} dateKey `yyyy-MM-dd`.
 * @param {number} [days] Days to add (can be negative).
 * @return {string} Shifted `yyyy-MM-dd`.
 */
export function addDaysToDateKey(dateKey: string, days: number): string {
  const m = ISO_DATE_RE.exec(dateKey);
  if (!m) return dateKey;
  const y = Number(m[1]);
  const mo = Number(m[2]);
  const d = Number(m[3]);
  const utcNoon = Date.UTC(y, mo - 1, d, 12, 0, 0);
  const shifted = new Date(utcNoon + days * 24 * 60 * 60 * 1000);
  const yy = shifted.getUTCFullYear();
  const mm = String(shifted.getUTCMonth() + 1).padStart(2, "0");
  const dd = String(shifted.getUTCDate()).padStart(2, "0");
  return `${yy}-${mm}-${dd}`;
}

/**
 * Parse preferred demo date from landing (`yyyy-MM-dd`) or legacy PPP strings.
 * @param {string | undefined} raw Requested date string.
 * @return {string | null} `yyyy-MM-dd` or null when unparseable.
 */
export function parseRequestedDemoDateKey(
  raw: string | undefined,
): string | null {
  if (!raw?.trim()) return null;
  const trimmed = raw.trim();

  const iso = ISO_DATE_RE.exec(trimmed);
  if (iso) {
    const mo = Number(iso[2]);
    const d = Number(iso[3]);
    if (mo >= 1 && mo <= 12 && d >= 1 && d <= 31) {
      return `${iso[1]}-${iso[2]}-${iso[3]}`;
    }
    return null;
  }

  const ppp = PPP_RE.exec(trimmed);
  if (ppp) {
    const month = MONTH_INDEX[ppp[1].toLowerCase()];
    const day = Number(ppp[2]);
    const year = Number(ppp[3]);
    if (month && day >= 1 && day <= 31 && year >= 2000) {
      return `${year}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
    }
  }

  return null;
}

/**
 * Parse preferred start time (`HH:mm` 24h). Defaults to 10:00 Manila.
 * @param {string | undefined} raw Requested time string.
 * @return {{ hour: number, minute: number }} Manila wall-clock start.
 */
export function parseRequestedDemoTime(
  raw: string | undefined,
): { hour: number; minute: number } {
  if (!raw?.trim()) {
    return { hour: DEMO_START_HOUR_MANILA, minute: DEMO_START_MINUTE_MANILA };
  }
  const m = TIME_RE.exec(raw.trim());
  if (!m) {
    return { hour: DEMO_START_HOUR_MANILA, minute: DEMO_START_MINUTE_MANILA };
  }
  const hour = Number(m[1]);
  const minute = Number(m[2]);
  if (
    !Number.isFinite(hour) ||
    !Number.isFinite(minute) ||
    hour < 0 ||
    hour > 23 ||
    minute < 0 ||
    minute > 59
  ) {
    return { hour: DEMO_START_HOUR_MANILA, minute: DEMO_START_MINUTE_MANILA };
  }
  return { hour, minute };
}

/**
 * Resolve the 1-hour demo window in Asia/Manila.
 * Missing/invalid date → next Manila calendar day. Missing time → 10:00.
 * @param {string | undefined} requestedDate Preferred date from the form.
 * @param {string | undefined} requestedTime Preferred start `HH:mm`.
 * @param {Date} [now] Reference instant.
 * @return {DemoSlot} Scheduled slot.
 */
export function resolveDemoSlot(
  requestedDate: string | undefined,
  requestedTime?: string,
  now = new Date(),
): DemoSlot {
  const todayKey = manilaDateKey(now);
  let dateKey = parseRequestedDemoDateKey(requestedDate);
  if (!dateKey || dateKey < todayKey) {
    dateKey = addDaysToDateKey(todayKey, 1);
  }

  const { hour, minute } = parseRequestedDemoTime(requestedTime);
  const [y, m, d] = dateKey.split("-").map(Number);
  const startsAt = manilaWallTimeToUtc(y, m, d, hour, minute);
  const endsAt = new Date(startsAt.getTime() + DEMO_DURATION_MINUTES * 60 * 1000);

  return {
    dateKey,
    startsAt,
    endsAt,
    startsAtIso: startsAt.toISOString(),
    endsAtIso: endsAt.toISOString(),
    timezone: DEMO_TIMEZONE,
    durationMinutes: DEMO_DURATION_MINUTES,
    startHour: hour,
    startMinute: minute,
  };
}

/**
 * Human-readable Manila slot for emails/UI.
 * @param {DemoSlot} slot Resolved slot.
 * @return {string} e.g. "September 18, 2026, 10:00–11:00 AM (Asia/Manila)".
 */
export function formatDemoSlotLabel(slot: DemoSlot): string {
  const datePart = slot.startsAt.toLocaleDateString("en-US", {
    timeZone: PHILIPPINE_TIMEZONE,
    year: "numeric",
    month: "long",
    day: "numeric",
  });
  const timeOpts: Intl.DateTimeFormatOptions = {
    timeZone: PHILIPPINE_TIMEZONE,
    hour: "numeric",
    minute: "2-digit",
    hour12: true,
  };
  const startLabel = slot.startsAt.toLocaleTimeString("en-US", timeOpts);
  const endLabel = slot.endsAt.toLocaleTimeString("en-US", timeOpts);
  return `${datePart}, ${startLabel}–${endLabel} (${DEMO_TIMEZONE})`;
}
