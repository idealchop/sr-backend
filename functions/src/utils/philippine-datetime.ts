export const PHILIPPINE_TIMEZONE = "Asia/Manila";
export const PHILIPPINE_LOCALE = "en-PH";

const DEFAULT_DATE_TIME: Intl.DateTimeFormatOptions = {
  timeZone: PHILIPPINE_TIMEZONE,
  month: "short",
  day: "numeric",
  year: "numeric",
  hour: "2-digit",
  minute: "2-digit",
  hour12: true,
};

/**
 * Normalizes Firestore Timestamp-like values, ISO strings, and Date instances.
 * @param {unknown} value Raw timestamp from Firestore or API payloads.
 * @return {Date | null} Parsed instant or null when not parseable.
 */
export function coerceToDate(value: unknown): Date | null {
  if (value == null || value === "") return null;
  if (value instanceof Date) {
    return Number.isNaN(value.getTime()) ? null : value;
  }
  if (typeof value === "number") {
    const d = new Date(value);
    return Number.isNaN(d.getTime()) ? null : d;
  }
  if (typeof value === "string") {
    const d = new Date(value);
    return Number.isNaN(d.getTime()) ? null : d;
  }
  if (typeof value === "object" && value !== null) {
    if (typeof (value as { toDate?: () => Date }).toDate === "function") {
      const d = (value as { toDate: () => Date }).toDate();
      return d instanceof Date && !Number.isNaN(d.getTime()) ? d : null;
    }
    if ("seconds" in value) {
      const sec = Number((value as { seconds: number }).seconds);
      if (Number.isFinite(sec)) return new Date(sec * 1000);
    }
  }
  return null;
}

/**
 * @param {unknown} value Firestore Timestamp, ISO string, or empty.
 * @param {Intl.DateTimeFormatOptions} options Optional Intl overrides.
 * @return {string} Human-readable date/time in Philippine timezone.
 */
export function formatPhilippineDateTime(
  value: unknown,
  options?: Intl.DateTimeFormatOptions,
): string {
  const d = coerceToDate(value);
  if (!d) return "—";
  return d.toLocaleString(PHILIPPINE_LOCALE, {
    ...DEFAULT_DATE_TIME,
    ...options,
  });
}

/**
 * @param {unknown} value Firestore Timestamp, ISO string, or empty.
 * @param {Intl.DateTimeFormatOptions} options Optional Intl overrides.
 * @return {string} Human-readable date in Philippine timezone.
 */
export function formatPhilippineDate(
  value: unknown,
  options?: Intl.DateTimeFormatOptions,
): string {
  const d = coerceToDate(value);
  if (!d) return "—";
  return d.toLocaleDateString(PHILIPPINE_LOCALE, {
    timeZone: PHILIPPINE_TIMEZONE,
    dateStyle: "long",
    ...options,
  });
}

/**
 * @param {unknown} value Firestore Timestamp, ISO string, or empty.
 * @return {string} Human-readable date/time for emails and PDFs.
 */
export function formatFirestorePhilippineDateTime(value: unknown): string {
  if (value == null || value === "") return "—";
  const formatted = formatPhilippineDateTime(value);
  return formatted === "—" && typeof value === "string" ? value : formatted;
}

/**
 * @param {unknown} value Firestore Timestamp, ISO string, or empty.
 * @return {string} Human-readable date for subscription and billing surfaces.
 */
export function formatFirestorePhilippineDate(value: unknown): string {
  if (value == null || value === "") return "—";
  const formatted = formatPhilippineDate(value);
  return formatted === "—" && typeof value === "string" ? value : formatted;
}

/**
 * @param {Date} now Current instant.
 * @return {number} Hour in 24h format (0–23) for Asia/Manila.
 */
export function manilaHour(now = new Date()): number {
  const parts = new Intl.DateTimeFormat("en-GB", {
    timeZone: PHILIPPINE_TIMEZONE,
    hour: "numeric",
    hour12: false,
  }).formatToParts(now);
  const hour = Number(parts.find((p) => p.type === "hour")?.value ?? "0");
  return Number.isFinite(hour) ? hour : 0;
}

/**
 * @param {Date} now Current instant.
 * @return {boolean} True when the calendar day is Monday in Asia/Manila.
 */
export function isManilaMonday(now = new Date()): boolean {
  const weekday = new Intl.DateTimeFormat("en-US", {
    timeZone: PHILIPPINE_TIMEZONE,
    weekday: "long",
  }).format(now);
  return weekday === "Monday";
}

/**
 * @param {Date} now Current instant.
 * @return {boolean} True when the calendar day is Sunday in Asia/Manila.
 */
export function isManilaSunday(now = new Date()): boolean {
  const weekday = new Intl.DateTimeFormat("en-US", {
    timeZone: PHILIPPINE_TIMEZONE,
    weekday: "long",
  }).format(now);
  return weekday === "Sunday";
}

/**
 * @param {Date} now Current instant.
 * @return {string} Calendar date `yyyy-MM-dd` in Asia/Manila.
 */
export function manilaDateKey(now = new Date()): string {
  return now.toLocaleDateString("en-CA", { timeZone: PHILIPPINE_TIMEZONE });
}

/**
 * Add calendar days to a Manila `yyyy-MM-dd` key (Philippines has no DST).
 * @param {string} dateKey Manila civil date.
 * @param {number} days Days to add (may be negative).
 * @return {string} Shifted `yyyy-MM-dd`.
 */
export function addManilaDateKey(dateKey: string, days: number): string {
  const [year, month, day] = dateKey.split("-").map(Number);
  const utc = Date.UTC(year, month - 1, day + days);
  return new Date(utc).toISOString().slice(0, 10);
}

/**
 * Whole calendar-day difference (b - a) using Manila date keys.
 * @param {string} fromKey Start `yyyy-MM-dd`.
 * @param {string} toKey End `yyyy-MM-dd`.
 * @return {number} Signed day count.
 */
export function manilaDateKeyDiff(fromKey: string, toKey: string): number {
  const [y1, m1, d1] = fromKey.split("-").map(Number);
  const [y2, m2, d2] = toKey.split("-").map(Number);
  const a = Date.UTC(y1, m1 - 1, d1);
  const b = Date.UTC(y2, m2 - 1, d2);
  return Math.round((b - a) / 86400000);
}

const PREFERRED_DAY_BY_WEEKDAY: Record<string, number> = {
  Mon: 1,
  Tue: 2,
  Wed: 3,
  Thu: 4,
  Fri: 5,
  Sat: 6,
  Sun: 7,
};

/**
 * Customer `preferredDays` numbering: 1 = Monday … 7 = Sunday (Manila weekday).
 * @param {Date} instant Instant to convert.
 * @return {number} 1–7.
 */
export function manilaPreferredDayNum(instant = new Date()): number {
  const weekday = new Intl.DateTimeFormat("en-US", {
    timeZone: PHILIPPINE_TIMEZONE,
    weekday: "short",
  }).format(instant);
  return PREFERRED_DAY_BY_WEEKDAY[weekday] ?? 1;
}

/**
 * Instant at 12:00 Asia/Manila for a civil date key (stable weekday lookup).
 * @param {string} dateKey `yyyy-MM-dd`.
 * @return {Date} UTC instant near Manila noon that day.
 */
export function manilaNoonFromDateKey(dateKey: string): Date {
  return new Date(`${dateKey}T04:00:00.000Z`);
}
