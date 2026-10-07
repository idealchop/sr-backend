import { db } from "../../config/firebase-admin";
import { ProductService } from "../products/product-service";
import { loadMergedProductIcons } from "../products/product-icon-service";
import {
  buildContainerCountContext,
  countWaterContainerQuantity,
  type ContainerCountContext,
} from "../../utils/container-daily-count";
import type { Transaction } from "../transactions/transaction-types";
import type { PlanLimitFrequency } from "../../utils/subscription-addon-plan-limits";

const MANILA_TZ = "Asia/Manila";

export class ContainerDailyLimitError extends Error {
  code = "CONTAINER_DAILY_LIMIT_EXCEEDED";

  constructor(
    message: string,
    public readonly used: number,
    public readonly cap: number,
    public readonly adding: number,
  ) {
    super(message);
    this.name = "ContainerDailyLimitError";
  }
}

function manilaDayStart(now = new Date()): Date {
  const formatter = new Intl.DateTimeFormat("en-CA", {
    timeZone: MANILA_TZ,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  });
  const parts = formatter.formatToParts(now);
  const y = parts.find((p) => p.type === "year")?.value ?? "1970";
  const m = parts.find((p) => p.type === "month")?.value ?? "01";
  const d = parts.find((p) => p.type === "day")?.value ?? "01";
  return new Date(`${y}-${m}-${d}T00:00:00+08:00`);
}

function toDate(value: unknown): Date | null {
  if (!value) return null;
  if (value instanceof Date) return value;
  if (typeof value === "string") {
    const parsed = new Date(value);
    return Number.isNaN(parsed.getTime()) ? null : parsed;
  }
  if (typeof value === "object" && value !== null) {
    if (typeof (value as { toDate?: () => Date }).toDate === "function") {
      return (value as { toDate: () => Date }).toDate();
    }
    if ("seconds" in value) {
      const sec = Number((value as { seconds: number }).seconds);
      if (Number.isFinite(sec)) return new Date(sec * 1000);
    }
  }
  return null;
}

export class ContainerDailyLimitService {
  static async resolveDailyCap(businessId: string): Promise<number | null> {
    const { SubscriptionService } = await import("./subscription-service");
    const quotas = await SubscriptionService.resolvePlanQuotasForBusiness(
      businessId,
    );
    return quotas?.containersDailyMax ?? quotas?.transactionsDailyMax ?? null;
  }

  static async loadCountContext(businessId: string): Promise<ContainerCountContext> {
    const [products, icons] = await Promise.all([
      ProductService.listItems(businessId),
      loadMergedProductIcons(),
    ]);
    return buildContainerCountContext(products, icons);
  }

  static quantityOnTransaction(
    transaction: Pick<Transaction, "type" | "waterRefills"> & {
      deliveryStatus?: Transaction["deliveryStatus"];
    },
    ctx: ContainerCountContext,
  ): number {
    return countWaterContainerQuantity({
      type: transaction.type,
      deliveryStatus: transaction.deliveryStatus,
      waterRefills: transaction.waterRefills,
      productById: ctx.productById,
      waterContainerIconIds: ctx.waterContainerIconIds,
      defaultIconId: ctx.defaultIconId,
    });
  }

  static async countUsedToday(businessId: string): Promise<number> {
    const start = manilaDayStart();
    const snap = await db
      .collection("businesses")
      .doc(businessId)
      .collection("transactions")
      .where("scheduledAt", ">=", start)
      .limit(500)
      .get();

    const ctx = await this.loadCountContext(businessId);
    let used = 0;
    for (const doc of snap.docs) {
      const data = doc.data() as Transaction;
      const when = toDate(data.scheduledAt) ?? toDate(data.createdAt);
      if (!when || when < start) continue;
      used += this.quantityOnTransaction(data, ctx);
    }
    return used;
  }

  static async getUsage(businessId: string): Promise<{
    cap: number | null;
    used: number;
    frequency: PlanLimitFrequency;
  }> {
    const cap = await this.resolveDailyCap(businessId);
    if (cap === null) {
      return { cap: null, used: 0, frequency: "daily" };
    }
    const used = await this.countUsedToday(businessId);
    return { cap, used, frequency: "daily" };
  }

  static async assertCanAdd(
    businessId: string,
    transaction: Pick<Transaction, "type" | "waterRefills"> & {
      deliveryStatus?: Transaction["deliveryStatus"];
    },
  ): Promise<void> {
    const cap = await this.resolveDailyCap(businessId);
    if (cap === null) return;

    const ctx = await this.loadCountContext(businessId);
    const adding = this.quantityOnTransaction(transaction, ctx);
    if (adding <= 0) return;

    const used = await this.countUsedToday(businessId);
    if (used + adding > cap) {
      throw new ContainerDailyLimitError(
        `Your plan allows ${cap} water containers per day. Upgrade to continue.`,
        used,
        cap,
        adding,
      );
    }
  }
}
