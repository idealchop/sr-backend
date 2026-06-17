import { db } from "../../config/firebase-admin";
import { SubscriptionService } from "../subscriptions/subscription-service";
import type { RawSubmission } from "./raw-submission-types";
import type {
  OnlineOrdersQuota,
  PlanLimitFrequency,
} from "../../utils/subscription-addon-plan-limits";

const MANILA_TZ = "Asia/Manila";

export class OnlineOrderLimitError extends Error {
  code = "ONLINE_ORDER_LIMIT_EXCEEDED";

  constructor(
    message: string,
    public readonly used: number,
    public readonly cap: number,
    public readonly frequency: PlanLimitFrequency,
  ) {
    super(message);
    this.name = "OnlineOrderLimitError";
  }
}

function manilaPeriodStart(
  frequency: PlanLimitFrequency,
  now = new Date(),
): Date {
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
  if (frequency === "monthly") {
    return new Date(`${y}-${m}-01T00:00:00+08:00`);
  }
  return new Date(`${y}-${m}-${d}T00:00:00+08:00`);
}

function toDate(value: unknown): Date | null {
  if (!value) return null;
  if (value instanceof Date) return value;
  if (typeof value === "string") {
    const d = new Date(value);
    return Number.isNaN(d.getTime()) ? null : d;
  }
  if (typeof value === "object" && value !== null) {
    if (typeof (value as { toDate?: () => Date }).toDate === "function") {
      return (value as { toDate: () => Date }).toDate();
    }
    if ("seconds" in value) {
      const sec = Number((value as { seconds: number }).seconds);
      if (Number.isFinite(sec)) return new Date(sec * 1000);
    }
    if ("_seconds" in value) {
      const sec = Number((value as { _seconds: number })._seconds);
      if (Number.isFinite(sec)) return new Date(sec * 1000);
    }
  }
  return null;
}

function countsTowardOnlineOrderLimit(status: unknown): boolean {
  const s = String(status || "");
  return s !== "cancelled" && s !== "rejected";
}

/** Portal submissions that share the online orders plan cap.
 * @param {unknown} type Raw submission type.
 * @return {boolean} Whether the type counts toward the cap.
 */
function countsAsOnlinePortalSubmission(type: unknown): boolean {
  return type === "PLACE_ORDER" || type === "REQUEST_COLLECTION";
}

export class OnlineOrderLimitService {
  static async resolveOnlineOrdersQuota(
    businessId: string,
  ): Promise<OnlineOrdersQuota | null> {
    const quotas = await SubscriptionService.resolvePlanQuotasForBusiness(businessId);
    return quotas?.onlineOrders ?? null;
  }

  static async countOnlineOrdersInPeriod(
    businessId: string,
    frequency: PlanLimitFrequency,
  ): Promise<number> {
    const start = manilaPeriodStart(frequency);
    const snap = await db
      .collection("businesses")
      .doc(businessId)
      .collection("raw_submissions")
      .where("submittedAt", ">=", start)
      .get();

    return snap.docs.filter((doc) => {
      const data = doc.data();
      if (!countsAsOnlinePortalSubmission(data.submissionType)) return false;
      if (!countsTowardOnlineOrderLimit(data.status)) return false;
      const submitted = toDate(data.submittedAt);
      return submitted !== null && submitted >= start;
    }).length;
  }

  static async getUsage(
    businessId: string,
  ): Promise<{
    quota: OnlineOrdersQuota | null;
    used: number;
  }> {
    const quota = await this.resolveOnlineOrdersQuota(businessId);
    if (!quota) {
      return { quota: null, used: 0 };
    }
    const used = await this.countOnlineOrdersInPeriod(
      businessId,
      quota.frequency,
    );
    return { quota, used };
  }

  /**
   * @deprecated Portal orders are accepted but flagged when over cap.
   * @param {string} businessId Business id (unused; kept for API compatibility).
   * @return {Promise<void>}
   */
  static async assertCanCreateOnlineOrder(businessId: string): Promise<void> {
    void businessId;
    return;
  }

  /**
   * True when the next portal order/collection would exceed the plan cap.
   * Customer still sees success.
   * @param {string} businessId Business id.
   * @return {Promise<boolean>}
   */
  static async willCreateBeyondOnlineOrderLimit(
    businessId: string,
  ): Promise<boolean> {
    const { quota, used } = await this.getUsage(businessId);
    if (!quota) return false;
    return used >= quota.max;
  }

  /**
   * Submission was created while the business was over its online order cap.
   * @param {RawSubmission} submission Raw portal submission row.
   * @return {boolean}
   */
  static submissionIsBeyondLimit(submission: RawSubmission): boolean {
    return (
      countsAsOnlinePortalSubmission(submission.submissionType) &&
      submission.metadata?.overOnlineOrderLimit === true
    );
  }

  /**
   * Staff access — re-check current plan quota so upgraded businesses can triage
   * submissions flagged at creation time on a lower tier.
   * @param {string} businessId Business id.
   * @param {RawSubmission} submission Raw portal submission row.
   * @return {Promise<boolean>}
   */
  static async staffCanAccessSubmission(
    businessId: string,
    submission: RawSubmission,
  ): Promise<boolean> {
    if (!this.submissionIsBeyondLimit(submission)) return true;
    const { quota, used } = await this.getUsage(businessId);
    if (!quota) return true;
    return used <= quota.max;
  }
}
