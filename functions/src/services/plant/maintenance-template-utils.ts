import {
  DEFAULT_MAINTENANCE_TEMPLATE_SEEDS,
  MAINTENANCE_DUE_SOON_DAYS,
  type MaintenanceTemplateRecord,
  type MaintenanceTemplateStatus,
} from "./maintenance-template-types";
import { checklistForTemplateSlug } from "./maintenance-checklists";
import { defaultConsumesForSlug } from "./maintenance-consumables";
import { manilaDateKey } from "../../utils/philippine-datetime";
import type { ProductionShiftRecord } from "./production-shift-types";

function parseManilaDateKey(dateKey: string): Date {
  return new Date(`${dateKey}T12:00:00+08:00`);
}

function addDays(base: Date, days: number): Date {
  const d = new Date(base);
  d.setDate(d.getDate() + days);
  return d;
}

export function addManilaDays(dateKey: string, days: number): string {
  const base = parseManilaDateKey(dateKey);
  return manilaDateKey(addDays(base, days));
}

function diffManilaCalendarDays(fromKey: string, toKey: string): number {
  const from = parseManilaDateKey(fromKey);
  const to = parseManilaDateKey(toKey);
  return Math.round((to.getTime() - from.getTime()) / (24 * 60 * 60 * 1000));
}

export type MaintenanceGallonContext = {
  dueAfterGallons?: number | null;
  gallonsSinceLastComplete?: number;
};

function calendarMaintenanceStatus(
  nextDueAt: string,
  now = new Date(),
): MaintenanceTemplateStatus {
  const todayKey = manilaDateKey(now);
  const diffDays = diffManilaCalendarDays(todayKey, nextDueAt);
  if (diffDays < 0) return "overdue";
  if (diffDays <= MAINTENANCE_DUE_SOON_DAYS) return "due_soon";
  return "ok";
}

function gallonMaintenanceStatus(
  context: MaintenanceGallonContext,
): MaintenanceTemplateStatus | null {
  const limit = Number(context.dueAfterGallons);
  const gallons = Number(context.gallonsSinceLastComplete ?? 0);
  if (!Number.isFinite(limit) || limit <= 0) return null;
  if (gallons >= limit) return "overdue";
  if (gallons >= limit * 0.9) return "due_soon";
  return "ok";
}

function worseStatus(
  a: MaintenanceTemplateStatus,
  b: MaintenanceTemplateStatus,
): MaintenanceTemplateStatus {
  const rank: Record<MaintenanceTemplateStatus, number> = {
    overdue: 0,
    due_soon: 1,
    ok: 2,
  };
  return rank[a] <= rank[b] ? a : b;
}

export function resolveMaintenanceTemplateStatus(
  nextDueAt: string,
  now = new Date(),
  gallonContext: MaintenanceGallonContext = {},
): MaintenanceTemplateStatus {
  const calendar = calendarMaintenanceStatus(nextDueAt, now);
  const gallon = gallonMaintenanceStatus(gallonContext);
  if (!gallon) return calendar;
  return worseStatus(calendar, gallon);
}

/**
 * MP-11 — sum production gallons since last PM completion (calendar date boundary).
 */
export function sumGallonsSinceLastComplete(
  shifts: ProductionShiftRecord[],
  lastCompletedAt: string | null,
): number {
  const sinceKey = lastCompletedAt ? manilaDateKey(new Date(lastCompletedAt)) : null;
  return shifts.reduce((sum, shift) => {
    if (sinceKey && shift.calendarDate < sinceKey) return sum;
    return sum + Math.max(0, Number(shift.gallonsProduced) || 0);
  }, 0);
}

export function buildDefaultMaintenanceTemplates(now = new Date()): Array<{
  slug: string;
  name: string;
  intervalDays: number;
  dueAfterGallons: number | null;
  gallonsSinceLastComplete: number;
  lastCompletedAt: null;
  nextDueAt: string;
}> {
  const today = manilaDateKey(now);
  return DEFAULT_MAINTENANCE_TEMPLATE_SEEDS.map((seed) => ({
    slug: seed.slug,
    name: seed.name,
    intervalDays: seed.intervalDays,
    dueAfterGallons: "dueAfterGallons" in seed ?
      Number(seed.dueAfterGallons) :
      null,
    gallonsSinceLastComplete: 0,
    lastCompletedAt: null,
    nextDueAt: addManilaDays(today, seed.intervalDays),
    checklist: checklistForTemplateSlug(seed.slug),
    consumes: defaultConsumesForSlug(seed.slug),
  }));
}

export function serializeMaintenanceTemplate(
  id: string,
  data: FirebaseFirestore.DocumentData,
  now = new Date(),
): MaintenanceTemplateRecord {
  const nextDueAt = String(data.nextDueAt ?? "");
  const slug = String(data.slug ?? id);
  const checklistRaw = data.checklist;
  const checklist = Array.isArray(checklistRaw) ?
    checklistRaw.filter((x): x is string => typeof x === "string" && x.trim().length > 0) :
    checklistForTemplateSlug(slug);
  const consumesRaw = data.consumes;
  const consumes = Array.isArray(consumesRaw) ?
    consumesRaw
      .filter((row) => row && typeof row === "object")
      .map((row) => {
        const o = row as Record<string, unknown>;
        const itemNameHint = String(o.itemNameHint || "").trim();
        const qty = Number(o.qty);
        if (!itemNameHint || !Number.isFinite(qty) || qty <= 0) return null;
        return { itemNameHint, qty };
      })
      .filter((row): row is { itemNameHint: string; qty: number } => row !== null) :
    defaultConsumesForSlug(slug);

  const dueAfterGallonsRaw = Number(data.dueAfterGallons);
  const dueAfterGallons =
    Number.isFinite(dueAfterGallonsRaw) && dueAfterGallonsRaw > 0 ?
      dueAfterGallonsRaw :
      null;
  const gallonsSinceLastComplete = Math.max(
    0,
    Number(data.gallonsSinceLastComplete ?? 0) || 0,
  );

  return {
    id,
    slug,
    name: String(data.name ?? id),
    intervalDays: Number(data.intervalDays ?? 30),
    dueAfterGallons,
    gallonsSinceLastComplete,
    lastCompletedAt:
      typeof data.lastCompletedAt === "string" ? data.lastCompletedAt : null,
    nextDueAt,
    status: resolveMaintenanceTemplateStatus(nextDueAt, now, {
      dueAfterGallons,
      gallonsSinceLastComplete,
    }),
    checklist,
    consumes,
    createdAt: String(data.createdAt ?? new Date().toISOString()),
    updatedAt: String(data.updatedAt ?? new Date().toISOString()),
  };
}

export function sortMaintenanceTemplates(
  rows: MaintenanceTemplateRecord[],
): MaintenanceTemplateRecord[] {
  const rank: Record<MaintenanceTemplateStatus, number> = {
    overdue: 0,
    due_soon: 1,
    ok: 2,
  };
  return [...rows].sort((a, b) => {
    const byStatus = rank[a.status] - rank[b.status];
    if (byStatus !== 0) return byStatus;
    if (a.nextDueAt !== b.nextDueAt) return a.nextDueAt.localeCompare(b.nextDueAt);
    return a.name.localeCompare(b.name);
  });
}

export function summarizeMaintenanceOverdue(
  rows: MaintenanceTemplateRecord[],
): { overdueCount: number; dueSoonCount: number; overdueNames: string[] } {
  const overdue = rows.filter((row) => row.status === "overdue");
  const dueSoon = rows.filter((row) => row.status === "due_soon");
  return {
    overdueCount: overdue.length,
    dueSoonCount: dueSoon.length,
    overdueNames: overdue.map((row) => row.name),
  };
}
