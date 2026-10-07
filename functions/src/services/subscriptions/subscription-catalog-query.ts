import { db } from "../../config/firebase-admin";
import { isCatalogLiveForNewSales } from "../../utils/catalog-publication";
import { isSelfServePricingPlan } from "../../utils/plan-capabilities";
import { parsePlanLimitations } from "../../utils/subscription-addon-plan-limits";
import { loadEffectiveTrialPolicy } from "./trial-policy-service";
import type { TrialPolicy } from "./trial-policy";

export type PublicCatalogPlan = {
  id: string;
  code: string;
  name: string;
  description: string;
  pricing: { monthly: number; yearly: number };
  limitations: Record<string, unknown>;
  capabilities: unknown;
  sortOrder: number;
  selfServe: boolean;
  features: string[];
};

export type PublicSubscriptionCatalog = {
  plans: PublicCatalogPlan[];
  trial: TrialPolicy;
};

function readPricing(data: Record<string, unknown>): { monthly: number; yearly: number } {
  const pricing = data.pricing as Record<string, unknown> | undefined;
  const monthly = Number(pricing?.monthly);
  const yearly = Number(pricing?.yearly);
  return {
    monthly: Number.isFinite(monthly) ? monthly : 0,
    yearly: Number.isFinite(yearly) ? yearly : 0,
  };
}

export function featureBulletsFromPlan(
  data: Record<string, unknown>,
): string[] {
  const quotas = parsePlanLimitations(data.limitations);
  const bullets: string[] = [];
  if (!quotas) return bullets;
  bullets.push(
    quotas.customersMax === null ?
      "Unlimited Customers" :
      `${quotas.customersMax} Customers`,
  );
  const containers = quotas.containersDailyMax ?? quotas.transactionsDailyMax;
  bullets.push(
    containers === null ?
      "Unlimited Containers / Day" :
      `${containers} Containers / Day`,
  );
  const orders = quotas.onlineOrders;
  if (!orders) {
    bullets.push("Unlimited Portal Orders & Collections");
  } else if (orders.max === 0) {
    bullets.push("QR portal orders not included");
  } else {
    bullets.push(
      `${orders.max} Portal Orders & Collections / ${orders.frequency === "monthly" ? "Month" : "Day"}`,
    );
  }
  const caps = data.capabilities as Record<string, unknown> | undefined;
  bullets.push(
    caps?.map === "full" ? "Interactive Map Enabled" : "Interactive Map Limited",
  );
  const staff = quotas.staffRiderMax || quotas.staffAdminMax;
  if (staff) {
    const rider = quotas.staffRiderMax ?? 0;
    const admin = quotas.staffAdminMax ?? 0;
    const parts: string[] = [];
    if (rider > 0) parts.push(`${rider} Rider App`);
    if (admin > 0) parts.push(`${admin} Admin App`);
    if (parts.length > 0) bullets.push(parts.join(" & "));
  }
  return bullets;
}

export async function loadPublicSubscriptionCatalog(
  now = new Date(),
): Promise<PublicSubscriptionCatalog> {
  const [planSnap, trial] = await Promise.all([
    db.collection("subscription_plans").get(),
    loadEffectiveTrialPolicy(now),
  ]);

  const plans = planSnap.docs
    .map((doc): PublicCatalogPlan | null => {
      const data = doc.data() as Record<string, unknown>;
      const code = String(data.code || doc.id || "").toLowerCase();
      if (!isCatalogLiveForNewSales(data, now)) return null;
      if (!isSelfServePricingPlan(data, code)) return null;
      const pricing = readPricing(data);
      const sortOrder = Number(data.sortOrder);
      return {
        id: doc.id,
        code,
        name: String(data.name || code),
        description: String(data.description || ""),
        pricing,
        limitations:
          data.limitations && typeof data.limitations === "object" ?
            (data.limitations as Record<string, unknown>) :
            {},
        capabilities: data.capabilities ?? null,
        sortOrder: Number.isFinite(sortOrder) ? sortOrder : 100,
        selfServe: true,
        features: featureBulletsFromPlan(data),
      };
    })
    .filter((row): row is PublicCatalogPlan => row !== null)
    .sort((a, b) => {
      if (a.sortOrder !== b.sortOrder) return a.sortOrder - b.sortOrder;
      return a.pricing.monthly - b.pricing.monthly;
    });

  return { plans, trial };
}
