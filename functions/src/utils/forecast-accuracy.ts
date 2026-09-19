import { manilaDateKeyDiff } from "./philippine-datetime";

export type ForecastKind = "delivery" | "collection";

export type ForecastPredictedItem = {
  type: string;
  qty: number;
};

export type ForecastAccuracyScores = {
  qtyScore: number;
  productScore: number;
  overallScore: number;
};

export type ForecastAccuracyRollupKind = {
  hitCount: number;
  missCount: number;
  avgOverallScore: number;
  lastPredictedQty: number;
  lastActualQty: number;
  lastOutcome: "hit" | "missed";
  lastScoredAt: string;
  recentOutcomes: Array<"hit" | "missed">;
  recentHits: Array<{
    qty: number;
    items: ForecastPredictedItem[];
    overallScore: number;
  }>;
};

export type ForecastAccuracyRollup = {
  delivery?: ForecastAccuracyRollupKind;
  collection?: ForecastAccuracyRollupKind;
};

export type ForecastRecommendedAction = "save" | "call" | "either";

const ROLLING_MAX = 4;

export function clampScore(value: number): number {
  if (!Number.isFinite(value)) return 0;
  return Math.max(0, Math.min(100, Math.round(value)));
}

export function forecastQtyScore(predictedQty: number, actualQty: number): number {
  const pred = Math.max(0, Number(predictedQty) || 0);
  const actual = Math.max(0, Number(actualQty) || 0);
  const denom = Math.max(pred, 1);
  return clampScore(100 * (1 - Math.min(1, Math.abs(pred - actual) / denom)));
}

function itemKey(type: string): string {
  return String(type || "")
    .trim()
    .toLowerCase()
    .replace(/\s+refill\s*$/i, "")
    .replace(/\s+/g, " ");
}

export function forecastProductScore(
  predicted: ForecastPredictedItem[],
  actual: ForecastPredictedItem[],
): number {
  const predMap = new Map<string, number>();
  for (const row of predicted) {
    const key = itemKey(row.type);
    if (!key) continue;
    predMap.set(key, (predMap.get(key) || 0) + Math.max(0, row.qty || 0));
  }
  const actualMap = new Map<string, number>();
  for (const row of actual) {
    const key = itemKey(row.type);
    if (!key) continue;
    actualMap.set(key, (actualMap.get(key) || 0) + Math.max(0, row.qty || 0));
  }
  const predTotal = [...predMap.values()].reduce((sum, qty) => sum + qty, 0);
  const actualTotal = [...actualMap.values()].reduce((sum, qty) => sum + qty, 0);
  if (predTotal <= 0 && actualTotal <= 0) return 100;
  if (predTotal <= 0 || actualTotal <= 0) return 0;

  const keys = new Set([...predMap.keys(), ...actualMap.keys()]);
  let overlap = 0;
  for (const key of keys) {
    overlap += Math.min(predMap.get(key) || 0, actualMap.get(key) || 0);
  }
  const denom = Math.max(predTotal, actualTotal);
  return clampScore(100 * (overlap / denom));
}

export function forecastOverallScore(qtyScore: number, productScore: number): number {
  return clampScore(0.7 * qtyScore + 0.3 * productScore);
}

export function scoreForecastAccuracy(
  predictedQty: number,
  actualQty: number,
  predictedItems: ForecastPredictedItem[],
  actualItems: ForecastPredictedItem[],
): ForecastAccuracyScores {
  const qtyScore = forecastQtyScore(predictedQty, actualQty);
  const productScore = forecastProductScore(predictedItems, actualItems);
  return {
    qtyScore,
    productScore,
    overallScore: forecastOverallScore(qtyScore, productScore),
  };
}

export function isWithinForecastMatchWindow(dateDeltaDays: number): boolean {
  return Math.abs(dateDeltaDays) <= 1;
}

export function emptyForecastRollupKind(): ForecastAccuracyRollupKind {
  return {
    hitCount: 0,
    missCount: 0,
    avgOverallScore: 0,
    lastPredictedQty: 0,
    lastActualQty: 0,
    lastOutcome: "missed",
    lastScoredAt: "",
    recentOutcomes: [],
    recentHits: [],
  };
}

export function applyForecastHitToRollup(
  previous: ForecastAccuracyRollupKind | undefined,
  input: {
    predictedQty: number;
    actualQty: number;
    items: ForecastPredictedItem[];
    overallScore: number;
    scoredAt: string;
  },
): ForecastAccuracyRollupKind {
  const base = previous ? { ...previous } : emptyForecastRollupKind();
  const recentHits = [
    {
      qty: input.actualQty,
      items: input.items,
      overallScore: input.overallScore,
    },
    ...base.recentHits,
  ].slice(0, ROLLING_MAX);
  const recentOutcomes = (["hit", ...base.recentOutcomes] as Array<"hit" | "missed">)
    .slice(0, ROLLING_MAX);
  const avgOverallScore = recentHits.length ?
    clampScore(
      recentHits.reduce((sum, row) => sum + row.overallScore, 0) / recentHits.length,
    ) :
    0;
  return {
    hitCount: base.hitCount + 1,
    missCount: base.missCount,
    avgOverallScore,
    lastPredictedQty: input.predictedQty,
    lastActualQty: input.actualQty,
    lastOutcome: "hit",
    lastScoredAt: input.scoredAt,
    recentOutcomes,
    recentHits,
  };
}

export function applyForecastMissToRollup(
  previous: ForecastAccuracyRollupKind | undefined,
  scoredAt: string,
): ForecastAccuracyRollupKind {
  const base = previous ? { ...previous } : emptyForecastRollupKind();
  return {
    ...base,
    missCount: base.missCount + 1,
    lastOutcome: "missed",
    lastScoredAt: scoredAt,
    recentOutcomes: (["missed", ...base.recentOutcomes] as Array<"hit" | "missed">)
      .slice(0, ROLLING_MAX),
  };
}

export function forecastRecommendedAction(
  rollup: ForecastAccuracyRollupKind | undefined,
): ForecastRecommendedAction {
  if (!rollup || (rollup.hitCount === 0 && rollup.missCount === 0)) {
    return "either";
  }
  if (rollup.lastOutcome === "missed" || rollup.avgOverallScore < 60) return "call";
  if (rollup.avgOverallScore >= 80 && !rollup.recentOutcomes.includes("missed")) {
    return "save";
  }
  return "either";
}

export function averageItemsFromRecentHits(
  rollup: ForecastAccuracyRollupKind | undefined,
): ForecastPredictedItem[] | null {
  const hits = rollup?.recentHits;
  if (!hits || hits.length === 0) return null;
  const qtyByType = new Map<string, number[]>();
  for (const hit of hits) {
    for (const item of hit.items) {
      const key = item.type.trim();
      if (!key) continue;
      const arr = qtyByType.get(key) || [];
      arr.push(Math.max(0, item.qty || 0));
      qtyByType.set(key, arr);
    }
  }
  if (qtyByType.size === 0) {
    const avgQty = Math.max(
      1,
      Math.round(hits.reduce((sum, hit) => sum + hit.qty, 0) / hits.length),
    );
    return [{ type: "Purified", qty: avgQty }];
  }
  return [...qtyByType.entries()].map(([type, arr]) => ({
    type,
    qty: Math.max(1, Math.round(arr.reduce((a, b) => a + b, 0) / arr.length)),
  }));
}

export type ForecastAccuracySummary = {
  hits: number;
  misses: number;
  avgOverallScore: number;
};

export function summarizeForecastOutcomes(
  outcomes: Array<{ outcome?: string; overallScore?: number }>,
): ForecastAccuracySummary {
  let hits = 0;
  let misses = 0;
  let scoreSum = 0;
  for (const row of outcomes) {
    if (row.outcome === "hit") {
      hits += 1;
      scoreSum += Number(row.overallScore) || 0;
    } else if (row.outcome === "missed") {
      misses += 1;
    }
  }
  return {
    hits,
    misses,
    avgOverallScore: hits > 0 ? clampScore(scoreSum / hits) : 0,
  };
}

export type ForecastMatchCandidate = {
  id: string;
  customerId?: string;
  type: string;
  dateKey: string;
  qty: number;
  items: ForecastPredictedItem[];
  alreadyScored: boolean;
};

export type ForecastMatchPick = {
  candidate: ForecastMatchCandidate;
  dateDeltaDays: number;
};

/**
 * Pick the closest matching ledger row: smallest |date delta|, then closest qty.
 * @param {object} predicted Suggestion identity and predicted qty.
 * @param {ForecastMatchCandidate[]} candidates Ledger rows already filtered to kind.
 * @param {Set<string>} claimedTxIds Transaction ids already used this run.
 * @return {ForecastMatchPick | null} Best match inside ±1 day, or null.
 */
export function pickForecastMatch(
  predicted: {
    customerId: string;
    predictedDate: string;
    predictedQty: number;
  },
  candidates: ForecastMatchCandidate[],
  claimedTxIds: Set<string>,
): ForecastMatchPick | null {
  const eligible: ForecastMatchPick[] = [];
  for (const candidate of candidates) {
    if (!candidate.id || claimedTxIds.has(candidate.id)) continue;
    if (candidate.alreadyScored) continue;
    if (candidate.customerId !== predicted.customerId) continue;
    const dateDeltaDays = manilaDateKeyDiff(predicted.predictedDate, candidate.dateKey);
    if (!isWithinForecastMatchWindow(dateDeltaDays)) continue;
    eligible.push({ candidate, dateDeltaDays });
  }
  if (eligible.length === 0) return null;
  eligible.sort((a, b) => {
    const absA = Math.abs(a.dateDeltaDays);
    const absB = Math.abs(b.dateDeltaDays);
    if (absA !== absB) return absA - absB;
    const qtyA = Math.abs(a.candidate.qty - predicted.predictedQty);
    const qtyB = Math.abs(b.candidate.qty - predicted.predictedQty);
    return qtyA - qtyB;
  });
  return eligible[0] ?? null;
}

export function forecastMatchWindowClosed(
  predictedDate: string,
  todayKey: string,
): boolean {
  return manilaDateKeyDiff(predictedDate, todayKey) > 1;
}
