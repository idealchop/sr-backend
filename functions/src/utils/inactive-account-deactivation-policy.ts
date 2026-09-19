import { coerceToDate } from "./philippine-datetime";

export const INACTIVE_ACCOUNT_UNUSED_DAYS = 30;

const MS_PER_DAY = 24 * 60 * 60 * 1000;

export function unusedDaysBetween(lastActivity: Date, now: Date): number {
  return Math.floor((now.getTime() - lastActivity.getTime()) / MS_PER_DAY);
}

export function shouldDeactivateForInactivity(input: {
  lastActivityAt: Date | null;
  createdAt: Date | null;
  alreadyDeactivated: boolean;
  now?: Date;
  unusedDays?: number;
}): boolean {
  if (input.alreadyDeactivated) return false;
  const now = input.now ?? new Date();
  const threshold = input.unusedDays ?? INACTIVE_ACCOUNT_UNUSED_DAYS;
  const last = input.lastActivityAt ?? input.createdAt;
  if (!last) return false;
  return unusedDaysBetween(last, now) >= threshold;
}

export function isWorkspaceInactivityDeactivated(
  data: Record<string, unknown> | undefined,
): boolean {
  return coerceToDate(data?.inactivityDeactivatedAt) != null;
}
