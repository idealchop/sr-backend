import {
  DEFAULT_MAINTENANCE_TEMPLATE_SEEDS,
  MAINTENANCE_DUE_SOON_DAYS,
  type MaintenanceTemplateRecord,
  type MaintenanceTemplateStatus,
} from "./maintenance-template-types";
import { manilaDateKey } from "../../utils/philippine-datetime";

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

export function resolveMaintenanceTemplateStatus(
  nextDueAt: string,
  now = new Date(),
): MaintenanceTemplateStatus {
  const todayKey = manilaDateKey(now);
  const diffDays = diffManilaCalendarDays(todayKey, nextDueAt);
  if (diffDays < 0) return "overdue";
  if (diffDays <= MAINTENANCE_DUE_SOON_DAYS) return "due_soon";
  return "ok";
}

export function buildDefaultMaintenanceTemplates(now = new Date()): Array<{
  slug: string;
  name: string;
  intervalDays: number;
  lastCompletedAt: null;
  nextDueAt: string;
}> {
  const today = manilaDateKey(now);
  return DEFAULT_MAINTENANCE_TEMPLATE_SEEDS.map((seed) => ({
    slug: seed.slug,
    name: seed.name,
    intervalDays: seed.intervalDays,
    lastCompletedAt: null,
    nextDueAt: addManilaDays(today, seed.intervalDays),
  }));
}

export function serializeMaintenanceTemplate(
  id: string,
  data: FirebaseFirestore.DocumentData,
  now = new Date(),
): MaintenanceTemplateRecord {
  const nextDueAt = String(data.nextDueAt ?? "");
  return {
    id,
    slug: String(data.slug ?? id),
    name: String(data.name ?? id),
    intervalDays: Number(data.intervalDays ?? 30),
    lastCompletedAt:
      typeof data.lastCompletedAt === "string" ? data.lastCompletedAt : null,
    nextDueAt,
    status: resolveMaintenanceTemplateStatus(nextDueAt, now),
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
