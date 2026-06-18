import { manilaDateKey } from "../../utils/philippine-datetime";
import {
  PRODUCTION_SHIFT_VALUES,
  type ProductionShiftInput,
  type ProductionShiftPeriod,
} from "./production-shift-types";

const DATE_KEY_RE = /^\d{4}-\d{2}-\d{2}$/;

export function normalizeProductionShiftPeriod(raw: unknown): ProductionShiftPeriod | null {
  if (typeof raw !== "string") return null;
  const upper = raw.trim().toUpperCase();
  return (PRODUCTION_SHIFT_VALUES as readonly string[]).includes(upper) ?
    (upper as ProductionShiftPeriod) :
    null;
}

export function normalizeProductionShiftCalendarDate(
  raw: unknown,
  now = new Date(),
): string | null {
  if (typeof raw !== "string" || !raw.trim()) return manilaDateKey(now);
  const trimmed = raw.trim();
  if (!DATE_KEY_RE.test(trimmed)) return null;
  const parsed = new Date(`${trimmed}T12:00:00+08:00`);
  return Number.isNaN(parsed.getTime()) ? null : trimmed;
}

export function normalizeNonNegativeNumber(
  raw: unknown,
): number | null {
  const n = Number(raw);
  if (!Number.isFinite(n) || n < 0) return null;
  return Math.round(n * 100) / 100;
}

export function buildProductionShiftDocId(
  calendarDate: string,
  shift: ProductionShiftPeriod,
): string {
  return `${calendarDate}_${shift}`;
}

export function parseProductionShiftInput(
  body: Record<string, unknown>,
  now = new Date(),
): { ok: true; value: ProductionShiftInput } | { ok: false; error: string } {
  const calendarDate = normalizeProductionShiftCalendarDate(body.calendarDate, now);
  if (!calendarDate) {
    return { ok: false, error: "calendarDate must be yyyy-MM-dd (Manila)" };
  }

  const shift = normalizeProductionShiftPeriod(body.shift);
  if (!shift) {
    return { ok: false, error: "shift must be AM or PM" };
  }

  const gallonsProduced = normalizeNonNegativeNumber(body.gallonsProduced);
  if (gallonsProduced == null) {
    return { ok: false, error: "gallonsProduced must be a non-negative number" };
  }

  const gallonsRejected = normalizeNonNegativeNumber(body.gallonsRejected ?? 0);
  if (gallonsRejected == null) {
    return { ok: false, error: "gallonsRejected must be a non-negative number" };
  }

  const notes =
    typeof body.notes === "string" && body.notes.trim() ?
      body.notes.trim().slice(0, 500) :
      undefined;

  return {
    ok: true,
    value: {
      calendarDate,
      shift,
      gallonsProduced,
      gallonsRejected,
      notes,
    },
  };
}
