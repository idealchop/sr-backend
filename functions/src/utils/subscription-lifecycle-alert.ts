import {
  computeDatesView,
  fetchRecentSubscriptionRows,
  pickEffectiveEntitling,
} from "../services/subscriptions/subscription-effective";

export type SubscriptionLifecyclePhase = "expiring_7d" | "expiring_1d" | "expired";

export type SubscriptionLifecycleSnapshot = {
  active: boolean;
  phase: SubscriptionLifecyclePhase | null;
  planName: string | null;
  daysUntilExpiry: number | null;
  headline: string | null;
};

function daysBetween(later: Date, earlier: Date): number {
  const ms = later.getTime() - earlier.getTime();
  return Math.max(0, Math.ceil(ms / (24 * 60 * 60 * 1000)));
}

/** NT-10 / NT-24 — expiring soon or expired subscription for owner alerts. */
export async function buildSubscriptionLifecycleSnapshot(
  businessId: string,
  now = new Date(),
): Promise<SubscriptionLifecycleSnapshot> {
  const rows = await fetchRecentSubscriptionRows(businessId);
  const effective = pickEffectiveEntitling(rows, now);
  if (!effective) {
    const expiredRow = rows.find((row) => {
      const view = computeDatesView(row.data, now);
      return view.isExpired || view.status === "expired";
    });
    if (expiredRow) {
      const planName = String(expiredRow.data.planName || "Smart Refill plan");
      return {
        active: true,
        phase: "expired",
        planName,
        daysUntilExpiry: 0,
        headline: `${planName} has expired — renew to keep premium features.`,
      };
    }
    return {
      active: false,
      phase: null,
      planName: null,
      daysUntilExpiry: null,
      headline: null,
    };
  }

  const view = computeDatesView(effective.data, now);
  const planName = String(effective.data.planName || "Smart Refill plan");
  const daysUntilExpiry = daysBetween(view.expiresAt, now);

  if (view.isExpired || view.status === "expired") {
    return {
      active: true,
      phase: "expired",
      planName,
      daysUntilExpiry: 0,
      headline: `${planName} has expired — renew to keep premium features.`,
    };
  }

  if (daysUntilExpiry <= 1) {
    return {
      active: true,
      phase: "expiring_1d",
      planName,
      daysUntilExpiry,
      headline: `${planName} expires tomorrow — renew now to avoid interruption.`,
    };
  }

  if (daysUntilExpiry <= 7) {
    return {
      active: true,
      phase: "expiring_7d",
      planName,
      daysUntilExpiry,
      headline:
        `${planName} expires in ${daysUntilExpiry} day` +
        `${daysUntilExpiry === 1 ? "" : "s"} — review billing in Account.`,
    };
  }

  return {
    active: false,
    phase: null,
    planName,
    daysUntilExpiry,
    headline: null,
  };
}
