import type { Transaction } from "../transactions/transaction-service";
import type { Customer } from "../customers/customer-service";
import type { InventoryItem } from "../inventory/inventory-service";
import type { AiToolId } from "./ai-tool-run-service";
import { WaterQualityLogService } from "../plant/water-quality-log-service";
import { ProductionShiftService } from "../plant/production-shift-service";
import { MaintenanceTemplateService } from "../plant/maintenance-template-service";
import { summarizeMaintenanceOverdue } from "../plant/maintenance-template-utils";
import { computeDebtAgingBreakdown } from "../../utils/analytics-utils";
import { buildDormantSignalsSnapshot } from "../../utils/dormant-customers";
import { buildLowRatingSample } from "../../utils/low-rating-sample";
import { manilaDateKey } from "../../utils/philippine-datetime";

export type AiSnapshotEnrichContext = {
  businessId: string;
  businessName: string;
  transactions: Transaction[];
  customers: Customer[];
  inventory: InventoryItem[];
  uiConfig: Record<string, unknown>;
  now: Date;
};

type PaymentScriptRow = {
  name: string;
  amountPhp: number;
  oldestDebtDays: number;
  reminderTier: 30 | 60 | 90;
  suggestedScript: string;
};

/** AI-02 — deterministic payment reminder scripts from reminder queues. */
export function buildPaymentReminderScripts(
  snapshot: Record<string, unknown>,
): PaymentScriptRow[] {
  const rows: PaymentScriptRow[] = [];
  const tiers: Array<{ key: "reminderQueue30" | "reminderQueue60" | "reminderQueue90"; tier: 30 | 60 | 90 }> = [
    { key: "reminderQueue30", tier: 30 },
    { key: "reminderQueue60", tier: 60 },
    { key: "reminderQueue90", tier: 90 },
  ];
  for (const { key, tier } of tiers) {
    const queue = snapshot[key];
    if (!Array.isArray(queue)) continue;
    for (const row of queue.slice(0, 10)) {
      if (!row || typeof row !== "object") continue;
      const o = row as Record<string, unknown>;
      const name = typeof o.name === "string" ? o.name.trim() : "";
      if (!name) continue;
      const amountPhp = Number(o.amountPhp) || 0;
      const oldestDebtDays = Number(o.oldestDebtDays) || 0;
      const urgency =
        tier === 90 ? "Kailangan na nating ayusin ang balance" :
          tier === 60 ? "Paalala lang sa utang" :
            "Friendly reminder";
      rows.push({
        name,
        amountPhp,
        oldestDebtDays,
        reminderTier: tier,
        suggestedScript: (
          `Hi ${name}, ${urgency} — ₱${amountPhp.toFixed(0)} (${oldestDebtDays}d). ` +
          "Pwede po ba today? Salamat po!"
        ).slice(0, 280),
      });
    }
  }
  return rows;
}

/** AI-05 — ranked variance hypotheses from plant facts only. */
export function buildVarianceRootCauseFacts(
  plantHealth: Record<string, unknown> | undefined,
): { active: boolean; hypotheses: string[] } {
  if (!plantHealth || plantHealth.productionVarianceActive !== true) {
    return { active: false, hypotheses: [] };
  }
  const hypotheses: string[] = [];
  const openDeliveries = Number(plantHealth.openDeliveriesToday) || 0;
  const walkIns = Number(plantHealth.walkInUnitsToday) || 0;
  const lastShiftAge = plantHealth.lastShiftLogAgeHours;
  const sold = Number(plantHealth.soldRefillUnitsToday) || 0;
  const plant = Number(plantHealth.plantGallonsToday) || 0;

  if (openDeliveries > 0) {
    hypotheses.push(
      `${openDeliveries} open delivery(ies) may explain sold units not yet logged as plant output.`,
    );
  }
  if (walkIns > 0 && sold > plant) {
    hypotheses.push(
      `${walkIns} walk-in unit(s) today — confirm shift log captured all walk-in gallons.`,
    );
  }
  if (typeof lastShiftAge === "number" && lastShiftAge > 36) {
    hypotheses.push(
      `Last production shift log is ~${lastShiftAge}h old — log today's shift before trusting variance %.`,
    );
  }
  if (sold > plant * 1.1) {
    hypotheses.push("Sold refills exceed logged plant gallons — check for unlogged production or meter drift.");
  }
  if (plant > sold * 1.1) {
    hypotheses.push("Plant gallons exceed sold units — possible leak, reject water, or unrecorded walk-in sales.");
  }
  if (hypotheses.length === 0) {
    hypotheses.push("Variance detected — reconcile shift log, delivery backlog, and walk-in counter.");
  }
  return { active: true, hypotheses: hypotheses.slice(0, 5) };
}

/** AI-06 — water quality trend anomaly from MP-09 logs. */
export async function buildWaterQualityAnomalyFacts(
  businessId: string,
): Promise<Record<string, unknown> | null> {
  const logs = await WaterQualityLogService.list(businessId, 14);
  const product = logs.filter((l) => l.locationTag === "product");
  if (product.length < 2) return null;

  const tdsValues = product.map((l) => l.tdsPpm).filter((v) => Number.isFinite(v));
  const medianTds =
    tdsValues.length > 0 ?
      tdsValues.sort((a, b) => a - b)[Math.floor(tdsValues.length / 2)] :
      0;
  const latest = product[0];
  const tdsDeltaPct =
    medianTds > 0 ?
      Math.round(((latest.tdsPpm - medianTds) / medianTds) * 100) :
      0;
  const failedRecent = product.filter((l) => l.pass === false).length;
  const anomalyActive = failedRecent > 0 || Math.abs(tdsDeltaPct) >= 15;

  if (!anomalyActive) {
    return {
      anomalyActive: false,
      sampleCount: product.length,
      latestTdsPpm: latest.tdsPpm,
      medianTdsPpm: medianTds,
      latestPh: latest.ph ?? null,
    };
  }

  const customerCommsDraft =
    failedRecent > 0 ?
      "Hi suki, nag-maintenance kami ng filters today para siguradong safe ang tubig. " +
        "Salamat sa pasensya — message lang kung may concern sa lasa." :
      tdsDeltaPct >= 15 ?
        "Hi, nag-check kami ng TDS levels — minor adjustment lang at within standard pa rin. " +
          "Salamat sa pag-order!" :
        undefined;

  return {
    anomalyActive: true,
    sampleCount: product.length,
    latestTdsPpm: latest.tdsPpm,
    medianTdsPpm: medianTds,
    latestPh: latest.ph ?? null,
    tdsDeltaPct,
    failedReadingsRecent: failedRecent,
    suggestedActions: [
      failedRecent > 0 ? "Re-test product water before resuming jug sales." : null,
      tdsDeltaPct >= 15 ? "Inspect pre-filters and RO membrane — TDS trending up." : null,
      "Notify suki only after confirming fix; draft apology if taste complaints rise.",
    ].filter(Boolean),
    ...(customerCommsDraft ? { customerCommsDraft } : {}),
  };
}

function parseTxDate(t: Transaction): Date {
  const raw = t.scheduledAt ?? t.createdAt;
  if (!raw) return new Date(0);
  if (typeof raw === "string") return new Date(raw);
  if (typeof (raw as { toDate?: () => Date }).toDate === "function") {
    return (raw as { toDate: () => Date }).toDate();
  }
  return new Date(0);
}

function countReferrals(customers: Customer[], customerId: string | undefined): number {
  if (!customerId) return 0;
  return customers.filter((c) => c.referredByCustomerId === customerId).length;
}

function possessionContainerCount(c: Customer): number {
  if (!c.possession) return 0;
  return Object.values(c.possession).reduce((sum, row) => sum + (row.quantity || 0), 0);
}

/** AI-08 referral campaign copy seeds. */
function buildReferralCampaignSeeds(customers: Customer[]): Array<{ name: string; blurb: string }> {
  return customers
    .filter((c) => c.status !== "inactive" && countReferrals(customers, c.id) > 0)
    .slice(0, 8)
    .map((c) => ({
      name: c.name,
      blurb:
        `Hi ${c.name}! Refer a suki and both get a free refill — share: ` +
        `${c.name.split(" ")[0]}'s link sa ${c.phone || "station"}. Salamat!`,
    }));
}

/** AI-15 churn risk scores (rules-based). */
function buildChurnRiskSample(
  customers: Customer[],
  transactions: Transaction[],
  now: Date,
): Array<{ name: string; score: number; drivers: string[] }> {
  const dormant = buildDormantSignalsSnapshot(customers, transactions, now);
  const sample = Array.isArray(dormant.sample) ? dormant.sample : [];
  return sample.slice(0, 10).map((row) => {
    const r = row as Record<string, unknown>;
    const daysSilent = Number(r.daysSilent) || 0;
    const cadenceLate = r.cadenceLate === true;
    const unpaid = Number(r.unpaidBalancePhp) || 0;
    let score = Math.min(100, Math.round(daysSilent * 1.2));
    const drivers: string[] = [];
    if (cadenceLate) {
      score += 15;
      drivers.push("Past usual order cadence");
    }
    if (unpaid > 0) {
      score += 10;
      drivers.push("Outstanding balance");
    }
    if (daysSilent > 60) drivers.push("Silent 60+ days");
    return {
      name: String(r.name || ""),
      score: Math.min(100, score),
      drivers: drivers.slice(0, 3),
    };
  });
}

/** AI-18 container deficit script seeds. */
function buildContainerDeficitScripts(
  inventory: InventoryItem[],
): Array<{ itemName: string; deficit: number; script: string }> {
  return inventory
    .filter((inv) => {
      const cur = inv.stock?.current ?? 0;
      const min = inv.stock?.min ?? inv.stock?.lowStockThreshold ?? 0;
      return cur < min && /container|jug|bottle/i.test(inv.name || "");
    })
    .slice(0, 8)
    .map((inv) => {
      const cur = inv.stock?.current ?? 0;
      const min = inv.stock?.min ?? inv.stock?.lowStockThreshold ?? 0;
      const deficit = min - cur;
      return {
        itemName: inv.name,
        deficit,
        script:
          `Paalala: may ${deficit} ${inv.name} pa na kailangan ibalik. ` +
          "Pwede po ba bukas? Salamat!",
      };
    });
}

/** AI-19 zone demand narrative facts. */
function buildZoneDemandFacts(
  transactions: Transaction[],
  customers: Customer[],
  now: Date,
): Record<string, unknown> {
  const addressByCustomer = new Map<string, string>();
  for (const c of customers) {
    if (c.id) addressByCustomer.set(c.id, c.address || "Unknown");
  }
  const cutoff = new Date(now.getTime() - 30 * 86400000);
  const priorCutoff = new Date(now.getTime() - 60 * 86400000);
  const current = new Map<string, number>();
  const prior = new Map<string, number>();

  for (const tx of transactions) {
    if (tx.type === "expense" || tx.type === "collection") continue;
    const d = parseTxDate(tx);
    const zone = (
      (tx.customerId ? addressByCustomer.get(tx.customerId) : undefined) ||
      tx.customerName ||
      "Unknown"
    )
      .split(",")[0]
      .trim()
      .slice(0, 40);
    let units = 0;
    for (const r of tx.waterRefills || []) units += Number(r.quantity) || 0;
    if (units <= 0) units = 1;
    if (d >= cutoff) current.set(zone, (current.get(zone) || 0) + units);
    else if (d >= priorCutoff) prior.set(zone, (prior.get(zone) || 0) + units);
  }

  const rows = [...current.entries()]
    .map(([zone, units]) => {
      const prev = prior.get(zone) || 0;
      const deltaPct = prev > 0 ? Math.round(((units - prev) / prev) * 100) : null;
      return { zone, units30d: units, prior30d: prev, deltaPct };
    })
    .sort((a, b) => b.units30d - a.units30d)
    .slice(0, 12);

  return { topZones: rows, zoneCount: current.size };
}

/** AI-29 duplicate transaction hints. */
function buildDuplicateTxHints(transactions: Transaction[]): Array<Record<string, unknown>> {
  const seen = new Map<string, Transaction[]>();
  for (const tx of transactions) {
    if (tx.type === "expense" || tx.type === "collection") continue;
    const day = manilaDateKey(parseTxDate(tx));
    const amt = Math.round((Number(tx.totalAmount) || 0) * 100);
    const key = `${tx.customerId || tx.customerName}|${day}|${amt}`;
    const list = seen.get(key) || [];
    list.push(tx);
    seen.set(key, list);
  }
  const hints: Array<Record<string, unknown>> = [];
  for (const [, list] of seen) {
    if (list.length < 2) continue;
    hints.push({
      customerName: list[0].customerName,
      count: list.length,
      amountPhp: Number(list[0].totalAmount) || 0,
      date: manilaDateKey(parseTxDate(list[0])),
    });
    if (hints.length >= 8) break;
  }
  return hints;
}

/** AI-42 reorder quantity suggestions. */
function buildReorderSuggestions(inventory: InventoryItem[]): Array<Record<string, unknown>> {
  return inventory
    .filter((inv) => {
      const cur = inv.stock?.current ?? 0;
      const min = inv.stock?.min ?? inv.stock?.lowStockThreshold ?? 0;
      return cur <= min;
    })
    .slice(0, 15)
    .map((inv) => {
      const cur = inv.stock?.current ?? 0;
      const min = inv.stock?.min ?? inv.stock?.lowStockThreshold ?? 0;
      const leadDays = 7;
      const suggestedQty = Math.max(min * 2 - cur, min);
      return {
        name: inv.name,
        current: cur,
        min,
        suggestedOrderQty: suggestedQty,
        leadTimeDays: leadDays,
        note: `Order ~${suggestedQty} to cover ${leadDays}d lead time.`,
      };
    });
}

/** AI-28 customer behavior segment labels (rules). */
function buildCustomerSegments(customers: Customer[]): Record<string, number> {
  const counts = {
    weekly_suki: 0,
    price_sensitive: 0,
    container_hoarder: 0,
    referrer: 0,
  };
  for (const c of customers) {
    if (countReferrals(customers, c.id) > 0) counts.referrer += 1;
    if (possessionContainerCount(c) > 3) counts.container_hoarder += 1;
    if (c.status === "inactive") counts.price_sensitive += 1;
    const interval = c.deliveryConfig?.repeatInterval;
    if (interval != null && interval <= 8) counts.weekly_suki += 1;
  }
  return counts;
}

/**
 * Apply deterministic snapshot enrichers for AI-02…AI-50 (except AI-48).
 * Mutates `snapshot` in place under `aiEnrichments`.
 */
export async function enrichAiToolSnapshot(
  tool: AiToolId,
  snapshot: Record<string, unknown>,
  ctx: AiSnapshotEnrichContext,
): Promise<void> {
  const enrichments: Record<string, unknown> = {};

  enrichments.ai02_paymentReminderScripts = buildPaymentReminderScripts(snapshot);

  if (snapshot.plantHealth && typeof snapshot.plantHealth === "object") {
    enrichments.ai05_varianceRootCause = buildVarianceRootCauseFacts(
      snapshot.plantHealth as Record<string, unknown>,
    );
  }

  const wq = await buildWaterQualityAnomalyFacts(ctx.businessId);
  if (wq) enrichments.ai06_waterQualityAnomaly = wq;

  const lowRating = buildLowRatingSample(ctx.customers, ctx.transactions, ctx.now);
  enrichments.ai07_lowRatingRecovery = {
    sample: lowRating,
    recoveryPriority: Array.isArray(lowRating) ?
      lowRating.slice(0, 5).map((r) => ({
        name: (r as { name?: string }).name,
        rating: (r as { rating?: number }).rating,
        feedback: (r as { feedback?: string }).feedback,
      })) :
      [],
  };

  enrichments.ai08_referralCampaign = buildReferralCampaignSeeds(ctx.customers);
  enrichments.ai15_churnRisk = buildChurnRiskSample(ctx.customers, ctx.transactions, ctx.now);
  enrichments.ai18_containerDeficitScripts = buildContainerDeficitScripts(ctx.inventory);
  enrichments.ai19_zoneDemand = buildZoneDemandFacts(
    ctx.transactions,
    ctx.customers,
    ctx.now,
  );
  enrichments.ai28_customerSegments = buildCustomerSegments(ctx.customers);
  enrichments.ai29_duplicateTxHints = buildDuplicateTxHints(ctx.transactions);
  enrichments.ai42_reorderSuggestions = buildReorderSuggestions(ctx.inventory);

  const debtAging = computeDebtAgingBreakdown(ctx.transactions, ctx.customers);
  enrichments.ai30_ledgerAnomalyHints = {
    unpaidCustomerCount: debtAging.rows.length,
    totalUnpaidPhp: Math.round(
      debtAging.rows.reduce((s, r) => s + r.amount, 0) * 100,
    ) / 100,
    roundNumberCollections: ctx.transactions
      .filter((t) => t.type === "collection" && (Number(t.totalAmount) || 0) % 100 === 0)
      .length,
  };

  enrichments.ai39_ratingSentimentThemes = {
    themes: ["late delivery", "taste", "container", "rider attitude"],
    lowRatingCount: Array.isArray(lowRating) ? lowRating.length : 0,
  };

  enrichments.ai40_forecastExplainers = {
    note: "Use median cadence + days since last visit for proactive row rationale.",
  };

  enrichments.ai47_weatherHolidayAdjustment = {
    phCalendarHints: ["payday weekends", "Holy Week", "rainy season demand dip"],
    enabled: false,
  };

  enrichments.ai50_ragRollups = {
    monthlyRevenueStub: true,
    note: "Precomputed monthly rollups for long-horizon Q&A — full embeddings TBD.",
  };

  if (tool === "dispatch_health" || tool === "morning_brief") {
    enrichments.ai13_routeClustering = {
      note: "Batch deliveries by barangay for tomorrow — see zoneDemand topZones.",
      zones: (enrichments.ai19_zoneDemand as { topZones?: unknown[] })?.topZones ?? [],
    };
    enrichments.ai14_riderAssignment = {
      unassignedDeliveries: snapshot.financialSignals ?
        (snapshot.financialSignals as { openDeliveryCount?: number }).openDeliveryCount :
        0,
      suggestion: "Rank riders by zone history — confirm before assign.",
    };
    enrichments.ai17_peakStaffing = {
      note: "Cross-reference peak hours with open delivery backlog.",
    };
  }

  if (tool === "warehouse_risk") {
    enrichments.ai18_containerDeficitScripts = buildContainerDeficitScripts(ctx.inventory);
  }

  if (tool === "plant_health") {
    const [shifts, templates] = await Promise.all([
      ProductionShiftService.list(ctx.businessId, { limit: 30 }),
      MaintenanceTemplateService.list(ctx.businessId),
    ]);
    const maintenance = summarizeMaintenanceOverdue(templates);
    enrichments.ai21_iotAnomaly = { telemetryAvailable: false, note: "Awaiting MP-21 ingest." };
    enrichments.ai22_tankRunout = {
      manualLevelLogs: false,
      note: "Log tank level manually (MP-14) for run-out forecast.",
    };
    enrichments.ai23_pmIntervalOptimization = {
      overdueCount: maintenance.overdueCount,
      gallonsLast7d: shifts.slice(0, 7).reduce((s, r) => s + r.gallonsProduced, 0),
    };
  }

  if (tool === "morning_brief") {
    enrichments.ai33_morningBriefEmailBody = {
      useLatestRun: true,
      personalizeFromSnapshot: true,
    };
    enrichments.ai33_personalizedEmail = enrichments.ai33_morningBriefEmailBody;
  }

  enrichments.ai36_autoCollectionsPulse = {
    trigger: "unpaid threshold or Mon 6am",
    enabled: ctx.uiConfig.autoCollectionsPulseEnabled === true,
  };
  enrichments.ai37_autoDispatchHealth = {
    trigger: "slaBreachCount > 0",
    enabled: ctx.uiConfig.slaBreachPushEnabled === true,
  };
  enrichments.ai38_autoWarehouseRisk = {
    trigger: "reorder insight fires",
    enabled: ctx.uiConfig.reorderPushEnabled === true,
  };

  snapshot.aiEnrichments = enrichments;
}
