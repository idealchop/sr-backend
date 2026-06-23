import { manilaDateKey } from "./philippine-datetime";

export const TANK_LOW_LEVEL_PCT = 15;

export type TankLevelLogLike = {
  recordedAt: string;
  rawPct?: number;
  productPct?: number;
  rejectPct?: number;
};

export type TankLevelTrendPoint = {
  dayKey: string;
  label: string;
  rawPct: number | null;
  productPct: number | null;
  rejectPct: number | null;
};

export type TankIotLevelLike = {
  name: string;
  levelPct: number | null;
  locationTag?: string | null;
};

function shortManilaLabel(dayKey: string): string {
  const [y, m, d] = dayKey.split("-").map(Number);
  const date = new Date(Date.UTC(y, m - 1, d, 12));
  return date.toLocaleDateString("en-PH", {
    timeZone: "Asia/Manila",
    month: "short",
    day: "numeric",
  });
}

function logManilaDayKey(recordedAt: string): string {
  const d = new Date(recordedAt);
  return Number.isNaN(d.getTime()) ? "" : manilaDateKey(d);
}

/** Latest manual reading per Manila calendar day. */
export function indexTankLogsByDay(logs: TankLevelLogLike[]): Map<string, TankLevelLogLike> {
  const byDay = new Map<string, TankLevelLogLike>();
  for (const log of logs) {
    const key = logManilaDayKey(log.recordedAt);
    if (!key) continue;
    const existing = byDay.get(key);
    if (!existing || log.recordedAt > existing.recordedAt) {
      byDay.set(key, log);
    }
  }
  return byDay;
}

/** MP-14 — line chart series for raw / product / reject % over N days. */
export function buildTankLevelTrendSeries(
  logs: TankLevelLogLike[],
  days = 7,
  now = new Date(),
): TankLevelTrendPoint[] {
  const safeDays = Math.min(90, Math.max(1, Math.round(days)));
  const byDay = indexTankLogsByDay(logs);
  const points: TankLevelTrendPoint[] = [];

  for (let i = safeDays - 1; i >= 0; i--) {
    const day = new Date(now);
    day.setDate(day.getDate() - i);
    const dayKey = manilaDateKey(day);
    const log = byDay.get(dayKey);
    points.push({
      dayKey,
      label: shortManilaLabel(dayKey),
      rawPct: log?.rawPct ?? null,
      productPct: log?.productPct ?? null,
      rejectPct: log?.rejectPct ?? null,
    });
  }

  return points;
}

export function buildTankLowLevelInsight(args: {
  latest: TankLevelLogLike | null;
  iot?: TankIotLevelLike[];
  threshold?: number;
}): string | null {
  const threshold = args.threshold ?? TANK_LOW_LEVEL_PCT;
  const messages: string[] = [];

  if (args.latest) {
    if ((args.latest.productPct ?? 100) < threshold) {
      messages.push(`Product tank at ${args.latest.productPct}%`);
    }
    if ((args.latest.rawPct ?? 100) < threshold) {
      messages.push(`Raw tank at ${args.latest.rawPct}%`);
    }
  }

  for (const row of args.iot ?? []) {
    if (row.levelPct != null && row.levelPct < threshold) {
      messages.push(`${row.name} sensor at ${row.levelPct}%`);
    }
  }

  if (messages.length === 0) return null;
  return `${messages.join(" · ")} — refill before peak hour.`;
}
