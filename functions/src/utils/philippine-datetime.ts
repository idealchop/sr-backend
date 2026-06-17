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
 * @return {string} Calendar date `yyyy-MM-dd` in Asia/Manila.
 */
export function manilaDateKey(now = new Date()): string {
  return now.toLocaleDateString("en-CA", { timeZone: PHILIPPINE_TIMEZONE });
}
