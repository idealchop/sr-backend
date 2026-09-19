/** Presenter / Google Calendar host for Request-a-Demo Meet events. */
export const DEMO_PRESENTER_EMAIL = "support@riverph.com";

/** Always invited alongside the inquiree and presenter. */
export const DEMO_ADDITIONAL_INVITEES = [
  "jimboy@smartrefill.io",
  "wina@riverph.com",
] as const;

export const DEMO_TIMEZONE = "Asia/Manila";
/** Default start hour when the form omits preferred time. */
export const DEMO_START_HOUR_MANILA = 10;
export const DEMO_START_MINUTE_MANILA = 0;
export const DEMO_DURATION_MINUTES = 60;

export const DEMO_CALENDAR_SCOPES = [
  "https://www.googleapis.com/auth/calendar",
  "https://www.googleapis.com/auth/calendar.events",
] as const;

/**
 * Workspace user the Functions SA impersonates (domain-wide delegation).
 * @return {string} Impersonation subject email.
 */
export function demoCalendarImpersonateUser(): string {
  return (
    process.env.SMARTREFILL_DEMO_CALENDAR_IMPERSONATE_USER?.trim() ||
    DEMO_PRESENTER_EMAIL
  );
}
