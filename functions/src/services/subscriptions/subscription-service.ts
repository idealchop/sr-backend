import type { DocumentReference } from "firebase-admin/firestore";
import { db, FieldValue, Timestamp } from "../../config/firebase-admin";
import { getDocIdFromAppSubscriptionPlans } from "../../utils/app-subscription-plans";
import {
  parsePlanLimitations,
  parsePlanSupportAccess,
  resolveEffectiveSupportAccess,
} from "../../utils/subscription-addon-plan-limits";
import {
  applyAddonBoostsToQuotas,
  buildAddonCatalogLookup,
  resolveAddonLimitBoostsFromLines,
  type AddonCatalogRow,
} from "../../utils/subscription-addon-limit-boosts";
import { logger, logAuditEvent } from "../observability/logging/logger";
import { NotificationService } from "../notifications/notification-service";
import { CustomerActiveLimitService } from "../customers/customer-active-limit-service";
import { deactivateAllNonOwnerWorkspaceMembers } from "../team/team-member-downgrade-policy";
import { countActiveStaffSeatsForBusiness } from "../team/staff-seat-usage";
import {
  applyStaffSeatAddonBoosts,
  computeStaffSeatLimitFromRoleQuotas,
} from "../../utils/staff-seat-limit";
import { OnlineOrderLimitService } from "../portal/online-order-limit-service";
import { ChannelUsageService } from "../channels/channel-usage-service";
import { isBusinessEligibleForCommunityMessenger } from "../../utils/community-messenger-plan-access";
import { readCommunityOrdersAcceptedThisMonth } from "../meta/community-dispatch-station-usage-service";
import { syncCommunityDispatchEnrollment } from "../meta/community-dispatch-enrollment-service";
import { SupportAiUsageService } from "../support/support-ai-usage-service";
import { runSubscriptionLifecycleMaintenance } from "./subscription-lifecycle-maintenance";
import { TrialLifecycleService } from "./trial-lifecycle-service";
import {
  resolveSupportAiPlanLimits,
  type SupportAiUsageSnapshot,
} from "../../utils/support-ai-plan-limits";
import { formatPhilippineDate } from "../../utils/philippine-datetime";
import {
  calculatePeriodDates,
  computeDatesView,
  fetchRecentSubscriptionRows,
  getActivatesAt,
  isStarterPlan,
  parseSubscriptionTimestamp,
  paymentReadyForActivation,
  pickEffectiveEntitling,
  pickPendingPaidUpgrade,
  pickPendingScheduled,
  promoteDueScheduledSubscriptions,
  shouldDeferRenewalToPeriodEnd,
  supersedeOtherEntitlingRows,
} from "./subscription-effective";

export interface SubscriptionPlan {
  id: string;
  code: string;
  name: string;
  pricing: {
    monthly: number;
    yearly: number;
  };
  features: string[];
  isTrialAvailable?: boolean;
}

/**
 * Subscription record in Firestore.
 */
export interface SubscriptionRecord {
  id: string;
  planId: string;
  planCode: string;
  planName: string;
  status:
    | "active"
    | "grace_period"
    | "expired"
    | "cancelled"
    | "past_due"
    | "approved"
    | "pending"
    | "scheduled"
    | "superseded";
  billingCycle: "monthly" | "yearly" | "trial";
  price: number;
  dates: {
    activatedAt?: Timestamp;
    expiresAt: Timestamp;
    renewalAt?: Timestamp;
    cancelledAt?: Timestamp;
    gracePeriodExpiresAt?: Timestamp;
    /** Paid renewal: do not entitle until this instant (current period expiresAt). */
    activatesAt?: Timestamp;
  };
  createdAt: Timestamp;
  cancelAtPeriodEnd?: boolean;

  // Billing & Payment Details
  voucherCode?: string;
  originalPrice?: number;
  discountAmount?: number;
  paymentMethod?: "gcash" | "maya" | "card" | "bank_transfer";
  paymentReference?: string;
  receiptUrl?: string;
  paymentStatus?: "pending_verification" | "verified" | "failed";
  metadata?: Record<string, any>;
}

export class SubscriptionService {
  /**
   * Robustly parses a potential timestamp/date field.
   * @param {any} ts The timestamp or date to parse.
   * @return {Date} The parsed Date object.
   */
  private static parseTimestamp(ts: any): Date {
    return parseSubscriptionTimestamp(ts);
  }

  /**
   * After ops approval: keep `scheduled` until activatesAt, or activate now.
   * @param {string} businessId The business ID.
   * @param {DocumentReference} subRef The subscription document reference.
   * @param {Record<string, unknown>} data The subscription document data.
   * @return {Promise<void>}
   */
  static async applyApprovalTransition(
    businessId: string,
    subRef: DocumentReference,
    data: Record<string, unknown>,
  ): Promise<void> {
    const now = new Date();
    const activatesAt = getActivatesAt(data);

    if (activatesAt && activatesAt > now) {
      await subRef.update({ status: "scheduled" });
      logger.info("Subscription approved; scheduled until period end", {
        businessId,
        activatesAt: activatesAt.toISOString(),
      });
      return;
    }

    const rawCycle = String(data.billingCycle || "monthly");
    const billingCycle: "monthly" | "yearly" =
      rawCycle === "yearly" ? "yearly" : "monthly";
    const { expiresAt, gracePeriodExpiresAt } = calculatePeriodDates(
      now,
      billingCycle,
    );

    const rows = await fetchRecentSubscriptionRows(businessId);
    await supersedeOtherEntitlingRows(businessId, subRef, rows, now);
    await subRef.update({
      "status": "active",
      "dates.activatedAt": Timestamp.fromDate(now),
      "dates.expiresAt": Timestamp.fromDate(expiresAt),
      "dates.renewalAt": Timestamp.fromDate(expiresAt),
      "dates.gracePeriodExpiresAt": Timestamp.fromDate(gracePeriodExpiresAt),
    });
    logger.info("Subscription approved; activated with period dates", {
      businessId,
      planCode: data.planCode,
      expiresAt: expiresAt.toISOString(),
    });
  }

  /**
   * Activates rows stuck at `approved` when payment is ready (trigger miss / legacy data).
   * @param {string} businessId Business id.
   * @return {Promise<void>}
   */
  static async repairStuckApprovedSubscriptions(businessId: string): Promise<void> {
    const rows = await fetchRecentSubscriptionRows(businessId);
    const now = new Date();
    for (const row of rows) {
      const st = String(row.data.status || "");
      if (st !== "approved") continue;
      if (!paymentReadyForActivation(row.data)) continue;
      const activatesAt = getActivatesAt(row.data);
      if (activatesAt && activatesAt > now) continue;
      await this.applyApprovalTransition(businessId, row.ref, row.data);
    }
  }

  /**
   * Resolves a catalog plan from Firestore.
   * @param {string} planCode The code of the plan to look up.
   * @return {Promise<any>} The plan data or null.
   */
  static async lookupPlanRowForCode(
    planCode: string,
  ): Promise<{ planId: string; planData: Record<string, unknown> } | null> {
    return this.resolvePlanFromFirestore(String(planCode || "").trim());
  }

  /**
   * Plan quotas from the active subscription row — no usage counters (avoids recursion).
   * @param {string} businessId Business id.
   * @return {Promise<ParsedPlanQuotas|null>}
   */
  static async resolvePlanQuotasForBusiness(
    businessId: string,
  ): Promise<ReturnType<typeof parsePlanLimitations>> {
    await this.repairStuckApprovedSubscriptions(businessId);
    await promoteDueScheduledSubscriptions(businessId);
    await this.ensureStarterWhenNoPaidAccess(businessId);
    const now = new Date();
    const rows = await fetchRecentSubscriptionRows(businessId);
    const effective = pickEffectiveEntitling(rows, now);
    const planCode = effective ?
      String(effective.data.planCode || "starter") :
      "starter";
    const planId = effective ? String(effective.data.planId || "") : undefined;
    const planRow = await this.fetchSubscriptionPlanRow(planId, planCode);
    return parsePlanLimitations(planRow?.limitations);
  }

  private static async resolvePlanFromFirestore(
    planCode: string,
  ): Promise<{ planId: string; planData: Record<string, unknown> } | null> {
    const pc = planCode;
    if (!pc) return null;
    try {
      const mappedId = await getDocIdFromAppSubscriptionPlans(pc);
      if (mappedId) {
        const d = await db.collection("subscription_plans").doc(mappedId).get();
        if (d.exists) {
          return {
            planId: d.id,
            planData: d.data() as Record<string, unknown>,
          };
        }
      }

      const q = await db
        .collection("subscription_plans")
        .where("code", "==", pc)
        .limit(1)
        .get();
      if (!q.empty) {
        return {
          planId: q.docs[0].id,
          planData: q.docs[0].data() as Record<string, unknown>,
        };
      }

      if (pc.toLowerCase() === "pro") {
        const q2 = await db
          .collection("subscription_plans")
          .where("code", "==", "grow")
          .limit(1)
          .get();
        if (!q2.empty) {
          return {
            planId: q2.docs[0].id,
            planData: q2.docs[0].data() as Record<string, unknown>,
          };
        }
      }
    } catch (e) {
      logger.warn("resolvePlanFromFirestore failed", {
        planCode: pc,
        error: e,
      });
    }
    return null;
  }

  /**
   * Loads a `subscription_plans` row by document id, then app registry / `code`.
   * @param {string | undefined} planId The ID of the plan.
   * @param {string} planCode The code of the plan.
   * @return {Promise<Record<string, unknown> | null>}
   */
  private static async fetchSubscriptionPlanRow(
    planId: string | undefined,
    planCode: string,
  ): Promise<Record<string, unknown> | null> {
    const code = String(planCode || "").trim();
    try {
      if (planId) {
        const d = await db.collection("subscription_plans").doc(planId).get();
        if (d.exists) return d.data() as Record<string, unknown>;
      }
      const resolved = await this.resolvePlanFromFirestore(code);
      return resolved ? resolved.planData : null;
    } catch (e) {
      logger.warn("fetchSubscriptionPlanRow failed", {
        planId,
        planCode: code,
        error: e,
      });
    }
    return null;
  }

  /**
   * Dashboard team seat cap: rider seats + admin seats (owner is always free and
   * not counted toward `currentStaffCount` or this limit).
   * @param {Record<string, any>} sub The subscription record.
   * @param {string} planCodeRaw The raw plan code.
   * @return {Promise<number>} The resolved staff limit.
   */
  private static async fetchAddonCatalogLookup(): Promise<
    Map<string, AddonCatalogRow>
    > {
    const snapshot = await db.collection("subscription_addons").get();
    const rows: AddonCatalogRow[] = snapshot.docs.map((doc) => ({
      id: doc.id,
      ...(doc.data() as Record<string, unknown>),
    }));
    return buildAddonCatalogLookup(rows);
  }

  private static async resolveDashboardStaffLimit(
    sub: Record<string, any>,
    planCodeRaw: string,
  ): Promise<number> {
    const planCode = planCodeRaw.toLowerCase();
    const staffLimits: Record<string, number> = {
      starter: 1,
      pro: 5,
      scale: 50,
    };
    const legacy =
      sub.billingCycle === "trial" ? 3 : staffLimits[planCode] || 1;

    const planRow = await this.fetchSubscriptionPlanRow(
      sub.planId,
      sub.planCode,
    );
    const lim = planRow?.limitations;
    if (!lim || typeof lim !== "object") return legacy;

    const staff = (lim as Record<string, unknown>).staff;
    if (!staff || typeof staff !== "object") return legacy;

    const q = parsePlanLimitations(lim);
    if (!q) return legacy;

    const rider = typeof q.staffRiderMax === "number" ? q.staffRiderMax : 0;
    const admin = typeof q.staffAdminMax === "number" ? q.staffAdminMax : 0;
    return computeStaffSeatLimitFromRoleQuotas(rider, admin);
  }

  /**
   * Calculates the grace period and expiration dates.
   * @param {Date} startDate The start date of the subscription.
   * @param {"monthly" | "yearly" | "trial"} cycle The billing cycle.
   * @return {{expiresAt: Date, gracePeriodExpiresAt: Date}} The calculated dates.
   */
  private static calculateDates(
    startDate: Date,
    cycle: "monthly" | "yearly" | "trial",
  ) {
    return calculatePeriodDates(startDate, cycle);
  }

  /**
   * Initializes a new subscription for a business.
   * @param {string} businessId The business ID.
   * @param {string} userId The user ID.
   * @param {string} planCode The plan code.
   * @param {"monthly" | "yearly" | "trial"} cycle The billing cycle.
   * @param {Partial<SubscriptionRecord>} paymentDetails Optional payment details.
   * @return {Promise<any>} The new subscription.
   */
  static async startSubscription(
    businessId: string,
    userId: string,
    planCode: string,
    cycle: "monthly" | "yearly" | "trial" = "monthly",
    paymentDetails: Partial<SubscriptionRecord> = {},
  ) {
    // 1. Fetch Plan (`apps.subscriptionPlans` doc id, then `code` query)
    const resolved = await this.resolvePlanFromFirestore(
      String(planCode || "").trim(),
    );
    let planData: any;
    let planId: string;

    if (!resolved) {
      // Fallback for emulator/initial setup
      planId = `${planCode}_default`;
      planData = {
        name: planCode.charAt(0).toUpperCase() + planCode.slice(1),
        pricing: { monthly: 29, yearly: 290 },
      };
    } else {
      planData = resolved.planData;
      planId = resolved.planId;
    }

    // 2. Check for trial eligibility if applicable
    if (cycle === "trial") {
      const existingTrials = await db
        .collection("businesses")
        .doc(businessId)
        .collection("audit_logs")
        .where("message", "==", "AUDIT: TRIAL_STARTED")
        .limit(1)
        .get();
      if (!existingTrials.empty) {
        throw new Error("Trial already used for this business");
      }
    }

    // 3. Create Subscription Record
    const { expiresAt, gracePeriodExpiresAt } = this.calculateDates(
      new Date(),
      cycle,
    );
    const subRef = db
      .collection("businesses")
      .doc(businessId)
      .collection("subscriptions")
      .doc();

    const subData = {
      planId,
      planCode,
      planName: planData.name,
      status: "active",
      billingCycle: cycle,
      price:
        cycle === "trial" ?
          0 :
          cycle === "monthly" ?
            planData.pricing.monthly :
            planData.pricing.yearly,
      dates: {
        activatedAt: FieldValue.serverTimestamp(),
        expiresAt: Timestamp.fromDate(expiresAt),
        renewalAt: Timestamp.fromDate(expiresAt),
        gracePeriodExpiresAt: Timestamp.fromDate(gracePeriodExpiresAt),
      },
      createdAt: FieldValue.serverTimestamp(),
      ...paymentDetails,
    };

    await subRef.set(subData);

    // 4. Audit & Notification
    logAuditEvent(
      cycle === "trial" ? "TRIAL_STARTED" : "SUBSCRIPTION_STARTED",
      {
        businessId,
        userId,
        planCode,
        subId: subRef.id,
      },
      null,
      subData,
    );

    await NotificationService.send({
      userId,
      businessId,
      title: "Subscription Activated",
      message:
        `Your ${planData.name} (${cycle}) is now active. ` +
        `Expires on ${formatPhilippineDate(expiresAt)}.`,
      type: "success",
    });

    return { id: subRef.id, ...subData };
  }

  /**
   * Handles subscription transitions (renew/upgrade/downgrade).
   */
  /**
   * Handles subscription transitions (renew/upgrade/downgrade).
   * @param {string} businessId The business ID.
   * @param {string} userId The user ID.
   * @param {string} targetPlanCode The target plan code.
   * @param {string} action The action being performed.
   * @param {Partial<SubscriptionRecord>} paymentDetails Optional payment details.
   * @return {Promise<void>}
   */
  static async transitionSubscription(
    businessId: string,
    userId: string,
    targetPlanCode: string,
    action: "RENEW" | "UPGRADE" | "DOWNGRADE",
    paymentDetails: Partial<SubscriptionRecord> = {},
  ) {
    const resolved = await this.resolvePlanFromFirestore(
      String(targetPlanCode || "").trim(),
    );
    let planData: any;
    let planId: string;

    if (!resolved) {
      planId = `${targetPlanCode}_default`;
      planData = {
        name: targetPlanCode.charAt(0).toUpperCase() + targetPlanCode.slice(1),
        pricing: { monthly: 49, yearly: 490 },
      };
    } else {
      planData = resolved.planData;
      planId = resolved.planId;
    }

    const now = new Date();
    const rows = await fetchRecentSubscriptionRows(businessId);
    const currentEffective = pickEffectiveEntitling(rows, now);
    const oldSub = currentEffective?.data ?? null;

    const rawCycle = (paymentDetails as { billingCycle?: string })
      ?.billingCycle;
    const cycle: "monthly" | "yearly" =
      String(rawCycle || "").toLowerCase() === "yearly" ? "yearly" : "monthly";

    const deferUntil = shouldDeferRenewalToPeriodEnd(
      action,
      currentEffective,
      now,
    );

    const paymentPending =
      String(paymentDetails.paymentStatus || "").toLowerCase() ===
      "pending_verification";
    const upgradingFromStarter =
      action === "UPGRADE" &&
      !!currentEffective &&
      isStarterPlan(String(currentEffective.data.planCode || ""));
    const deferPeriodDates =
      upgradingFromStarter && paymentPending && !deferUntil;

    const periodStart = deferUntil ?? now;
    const { expiresAt, gracePeriodExpiresAt } = this.calculateDates(
      periodStart,
      cycle,
    );

    const subRef = db
      .collection("businesses")
      .doc(businessId)
      .collection("subscriptions")
      .doc();

    const price =
      cycle === "yearly" ? planData.pricing.yearly : planData.pricing.monthly;

    const dates: Record<string, unknown> = {};
    if (!deferPeriodDates) {
      dates.expiresAt = Timestamp.fromDate(expiresAt);
      dates.renewalAt = Timestamp.fromDate(expiresAt);
      dates.gracePeriodExpiresAt = Timestamp.fromDate(gracePeriodExpiresAt);
    }

    let status = "active";
    let notifyMessage: string;

    const currentPlanName = String(oldSub?.planName || oldSub?.planCode || "plan");

    if (paymentPending && !deferUntil) {
      status = "pending";
      notifyMessage =
        `Your ${action.toLowerCase()} to ${planData.name} is pending payment verification. ` +
        "We'll activate your plan once payment is confirmed.";
    } else if (deferUntil) {
      status = "scheduled";
      dates.activatesAt = Timestamp.fromDate(deferUntil);
      if (action === "DOWNGRADE") {
        notifyMessage = paymentPending ?
          `Your downgrade to ${planData.name} is pending approval. ` +
            `${currentPlanName} stays active until ${formatPhilippineDate(deferUntil)}.` :
          `Your downgrade to ${planData.name} is scheduled for ` +
            `${formatPhilippineDate(deferUntil)}.`;
      } else if (action === "UPGRADE") {
        notifyMessage = paymentPending ?
          `Your upgrade to ${planData.name} is pending approval. ` +
            `${currentPlanName} stays active until ${formatPhilippineDate(deferUntil)}.` :
          `Your upgrade to ${planData.name} is scheduled for ` +
            `${formatPhilippineDate(deferUntil)} when your current period ends.`;
      } else {
        notifyMessage =
          `Your ${planData.name} renewal is confirmed. ` +
          `It will start on ${formatPhilippineDate(deferUntil)} when your current period ends.`;
      }
    } else if (deferPeriodDates) {
      status = "pending";
      notifyMessage =
        `Your upgrade to ${planData.name} is pending payment verification. ` +
        "Starter access ends now; paid features start once approved.";
    } else {
      dates.activatedAt = FieldValue.serverTimestamp();
      if (action === "DOWNGRADE" && paymentPending) {
        notifyMessage =
          `Your downgrade to ${planData.name} is pending approval.`;
      } else {
        notifyMessage = `Successfully ${action.toLowerCase()}d to ${planData.name}.`;
      }
    }

    const paymentMetadata =
      paymentDetails.metadata && typeof paymentDetails.metadata === "object" ?
        paymentDetails.metadata :
        {};
    const mergedMetadata =
      action === "DOWNGRADE" ?
        { ...paymentMetadata, changeType: "downgrade" } :
        paymentMetadata;

    const newData = {
      planId,
      planCode: targetPlanCode,
      planName: planData.name,
      billingCycle: cycle,
      price,
      createdAt: FieldValue.serverTimestamp(),
      ...paymentDetails,
      ...(Object.keys(mergedMetadata).length > 0 ?
        { metadata: mergedMetadata } :
        {}),
      status,
      dates,
    };

    await subRef.set(newData);

    if (upgradingFromStarter) {
      const allRows = await fetchRecentSubscriptionRows(businessId);
      await supersedeOtherEntitlingRows(businessId, subRef, allRows, now);
    }

    if (action === "DOWNGRADE") {
      await deactivateAllNonOwnerWorkspaceMembers(businessId);
      if (!deferUntil) {
        await CustomerActiveLimitService.applyPlanDowngradeActivePolicyForBusiness(
          businessId,
        );
      }
    }

    logAuditEvent(
      `SUBSCRIPTION_${action}`,
      { businessId, userId, planCode: targetPlanCode, deferred: !!deferUntil },
      oldSub,
      newData,
    );

    const notifyTitle =
      action === "DOWNGRADE" && paymentPending ?
        "Downgrade pending approval" :
        deferUntil ?
          action === "DOWNGRADE" ? "Downgrade scheduled" : "Renewal scheduled" :
          `Subscription ${action.toLowerCase()}d`;

    await NotificationService.send({
      userId,
      businessId,
      title: notifyTitle,
      message: notifyMessage,
      type: action === "DOWNGRADE" && paymentPending ? "warning" : "success",
    });
  }

  /**
   * Retrieves the current subscription status for a business.
   * @param {string} businessId The business ID.
   * @return {Promise<any>} The current subscription status.
   */
  /**
   * If there is no active paid/trial access and no queued renewal, ensure a Starter row exists.
   * @param {string} businessId The business ID.
   * @return {Promise<void>}
   */
  static async ensureStarterWhenNoPaidAccess(businessId: string): Promise<void> {
    await promoteDueScheduledSubscriptions(businessId);
    const now = new Date();
    const rows = await fetchRecentSubscriptionRows(businessId);
    if (pickPendingScheduled(rows, now)) return;
    if (pickPendingPaidUpgrade(rows, now)) return;
    if (pickEffectiveEntitling(rows, now)) return;
    if (await TrialLifecycleService.hasResumablePausedTrial(businessId)) return;
    await this.handleAutoDowngrade(businessId);
  }

  /** Emulator/BDD: single active Scale trial row (shared user123 workspace isolation). */
  static readonly BDD_TRIAL_SUBSCRIPTION_DOC_ID = "bdd-trial-sub";

  static async resetBusinessToTrialForEmulator(
    businessId: string,
  ): Promise<void> {
    const subCol = db
      .collection("businesses")
      .doc(businessId)
      .collection("subscriptions");
    const snap = await subCol.get();
    const refs = snap.docs.map((d) => d.ref);
    for (let i = 0; i < refs.length; i += 400) {
      const batch = db.batch();
      for (const ref of refs.slice(i, i + 400)) {
        batch.delete(ref);
      }
      await batch.commit();
    }

    const now = new Date();
    const { expiresAt, gracePeriodExpiresAt } = calculatePeriodDates(
      now,
      "trial",
    );
    const tsNow = Timestamp.fromDate(now);

    await subCol.doc(this.BDD_TRIAL_SUBSCRIPTION_DOC_ID).set({
      planId: "scale",
      planCode: "scale",
      planName: "Scale Plan",
      status: "active",
      billingCycle: "trial",
      price: 0,
      dates: {
        activatedAt: tsNow,
        expiresAt: Timestamp.fromDate(expiresAt),
        renewalAt: Timestamp.fromDate(expiresAt),
        gracePeriodExpiresAt: Timestamp.fromDate(gracePeriodExpiresAt),
      },
      createdAt: tsNow,
    });
  }

  static async resolveSupportAiUsageForBusiness(
    businessId: string,
    input: {
      planCode: string;
      billingCycle: string;
      status: string;
      isExpired: boolean;
      agentChatEnabled: boolean;
      planLimitations?: unknown;
    },
  ): Promise<SupportAiUsageSnapshot> {
    const limits = resolveSupportAiPlanLimits({
      planCode: input.planCode,
      billingCycle: input.billingCycle,
      status: input.status,
      isExpired: input.isExpired,
      agentChatEnabled: input.agentChatEnabled,
      limitations: input.planLimitations,
    });
    return SupportAiUsageService.getUsageSnapshot(businessId, limits);
  }

  static async getSubscriptionStatus(businessId: string) {
    await TrialLifecycleService.resumeTrialIfPaused(businessId);
    await this.repairStuckApprovedSubscriptions(businessId);
    await promoteDueScheduledSubscriptions(businessId);
    const lifecycle = await runSubscriptionLifecycleMaintenance(businessId);
    await this.ensureStarterWhenNoPaidAccess(businessId);

    const now = new Date();
    const rows = await fetchRecentSubscriptionRows(businessId);
    const effective = pickEffectiveEntitling(rows, now);
    const pendingScheduled = pickPendingScheduled(rows, now);
    const pendingPaidUpgrade = pickPendingPaidUpgrade(rows, now);

    if (!effective) {
      const starterPlan = await this.fetchSubscriptionPlanRow(undefined, "starter");
      const starterQuotas = parsePlanLimitations(starterPlan?.limitations);
      const starterOnlineOrdersUsed = starterQuotas?.onlineOrders ?
        await OnlineOrderLimitService.countOnlineOrdersInPeriod(
          businessId,
          starterQuotas.onlineOrders.frequency,
        ) :
        0;
      const starterChannelUsage = await ChannelUsageService.getStatusSnapshot(businessId);
      void syncCommunityDispatchEnrollment(businessId).catch((error) => {
        logger.error("syncCommunityDispatchEnrollment failed", { businessId, error });
      });
      const communityMessenger = {
        planEligible: false,
        ordersAcceptedThisMonth: await readCommunityOrdersAcceptedThisMonth(businessId),
      };
      const pendingUpgradePayload = pendingPaidUpgrade ?
        {
          planCode: String(pendingPaidUpgrade.data.planCode || ""),
          planName: String(pendingPaidUpgrade.data.planName || ""),
          paymentStatus: pendingPaidUpgrade.data.paymentStatus,
          billingCycle: pendingPaidUpgrade.data.billingCycle,
        } :
        undefined;
      return {
        status: pendingPaidUpgrade ? "pending" : "active",
        planCode: "starter",
        planName: "Starter",
        billingCycle: "monthly",
        isExpired: false,
        isGracePeriod: false,
        daysUntilExpiration: 0,
        sessionResetRequired: lifecycle.graceEnded && lifecycle.downgradedToStarter,
        paymentStatus: pendingPaidUpgrade ?
          String(pendingPaidUpgrade.data.paymentStatus || "pending_verification") :
          undefined,
        pendingUpgrade: pendingUpgradePayload,
        limitations: {
          staffLimit: 1,
          currentStaffCount: 0,
          customersMax: starterQuotas?.customersMax ?? null,
          transactionsDailyMax: starterQuotas?.transactionsDailyMax ?? null,
          aiToolsMonthlyMax: starterQuotas?.aiToolsMonthlyMax ?? null,
          onlineOrdersMax: starterQuotas?.onlineOrders?.max ?? null,
          onlineOrdersFrequency: starterQuotas?.onlineOrders?.frequency ?? null,
          onlineOrdersUsed: starterOnlineOrdersUsed,
          channelUsage: starterChannelUsage,
          communityMessenger,
        },
        supportAccess: { level: "community", chatEnabled: false },
        supportAi: await this.resolveSupportAiUsageForBusiness(businessId, {
          planCode: "starter",
          billingCycle: "monthly",
          status: "active",
          isExpired: false,
          agentChatEnabled: false,
          planLimitations: starterPlan?.limitations,
        }),
      };
    }

    const sub = effective.data;
    const view = computeDatesView(sub, now);
    const { expiresAt, status } = view;

    if (status === "active" && now <= expiresAt) {
      await this.handleExpiryAlert(businessId, sub, now, expiresAt, effective.id);
    }

    const currentStaffCount = (await countActiveStaffSeatsForBusiness(businessId)).total;

    let staffLimit = await this.resolveDashboardStaffLimit(
      sub as Record<string, any>,
      String(sub.planCode || ""),
    );

    const planRow = await this.fetchSubscriptionPlanRow(
      String(sub.planId || ""),
      String(sub.planCode || ""),
    );
    const planQuotas = parsePlanLimitations(planRow?.limitations);
    const catalogLookup = await this.fetchAddonCatalogLookup();
    const addonBoosts = resolveAddonLimitBoostsFromLines(
      sub as Record<string, unknown>,
      catalogLookup,
    );
    const boostedQuotas = applyAddonBoostsToQuotas(planQuotas, addonBoosts);
    staffLimit = applyStaffSeatAddonBoosts(
      staffLimit,
      addonBoosts.staffRider,
      addonBoosts.staffAdmin,
    );
    const onlineOrdersUsed = planQuotas?.onlineOrders ?
      await OnlineOrderLimitService.countOnlineOrdersInPeriod(
        businessId,
        planQuotas.onlineOrders.frequency,
      ) :
      0;
    const channelUsage = await ChannelUsageService.getStatusSnapshot(businessId);
    void syncCommunityDispatchEnrollment(businessId).catch((error) => {
      logger.error("syncCommunityDispatchEnrollment failed", { businessId, error });
    });
    const communityPlanEligible = await isBusinessEligibleForCommunityMessenger(businessId);
    const communityMessenger = {
      planEligible: communityPlanEligible,
      ordersAcceptedThisMonth: await readCommunityOrdersAcceptedThisMonth(businessId),
    };
    const planSupport = parsePlanSupportAccess(
      planRow?.limitations,
      String(sub.planCode || ""),
    );
    const supportAccess = resolveEffectiveSupportAccess({
      planSupport,
      planCode: String(sub.planCode || ""),
      billingCycle: String(sub.billingCycle || ""),
      status,
      isExpired: view.isExpired,
    });

    const pendingRenewal = pendingScheduled ?
      {
        planCode: String(pendingScheduled.data.planCode || ""),
        planName: String(pendingScheduled.data.planName || ""),
        activatesAt: getActivatesAt(pendingScheduled.data)?.toISOString(),
        paymentStatus: pendingScheduled.data.paymentStatus,
      } :
      undefined;

    return {
      ...sub,
      status,
      isExpired: view.isExpired,
      isGracePeriod: view.isGracePeriod,
      sessionResetRequired: lifecycle.graceEnded && lifecycle.downgradedToStarter,
      daysUntilExpiration: Math.max(
        0,
        Math.ceil(
          (expiresAt.getTime() - now.getTime()) / (1000 * 60 * 60 * 24),
        ),
      ),
      limitations: {
        staffLimit,
        currentStaffCount,
        customersMax: boostedQuotas?.customersMax ?? null,
        transactionsDailyMax: boostedQuotas?.transactionsDailyMax ?? null,
        aiToolsMonthlyMax: boostedQuotas?.aiToolsMonthlyMax ?? null,
        onlineOrdersMax: boostedQuotas?.onlineOrders?.max ?? null,
        onlineOrdersFrequency: boostedQuotas?.onlineOrders?.frequency ?? null,
        onlineOrdersUsed,
        addonBoosts,
        channelUsage,
        communityMessenger,
      },
      supportAccess,
      supportAi: await this.resolveSupportAiUsageForBusiness(businessId, {
        planCode: String(sub.planCode || ""),
        billingCycle: String(sub.billingCycle || ""),
        status,
        isExpired: view.isExpired,
        agentChatEnabled: supportAccess.chatEnabled,
        planLimitations: planRow?.limitations,
      }),
      pendingRenewal,
    };
  }

  /**
   * Helper to handle automatic downgrade to starter plan.
   * @param {string} businessId The business ID.
   * @return {Promise<void>}
   */
  public static async handleAutoDowngrade(businessId: string) {
    try {
      await promoteDueScheduledSubscriptions(businessId);

      const now = new Date();
      const rows = await fetchRecentSubscriptionRows(businessId);
      const effective = pickEffectiveEntitling(rows, now);
      const pendingScheduled = pickPendingScheduled(rows, now);

      if (pendingScheduled) {
        return;
      }

      if (effective) {
        const code = String(effective.data.planCode || "").toLowerCase();
        const view = computeDatesView(effective.data, now);
        if (code === "starter" || code === "free") return;
        if (!view.isExpired) return;
      }

      const latest = rows[0];
      const row = (latest?.data ?? {}) as unknown as SubscriptionRecord;
      const code = String(row.planCode || "").toLowerCase();
      if (code === "starter") {
        return;
      }

      await this.transitionSubscription(
        businessId,
        "SYSTEM",
        "starter",
        "DOWNGRADE",
      );
      await NotificationService.broadcastToBusiness(businessId, {
        title: "Subscription Expired",
        message:
          "Your subscription has been automatically downgraded to the Starter plan.",
        type: "warning",
      });
    } catch (error) {
      logger.error(`Failed to auto-downgrade business ${businessId}`, error);
    }
  }

  /**
   * Helper to send expiry alert 7 days before.
   * @param {string} businessId The business ID.
   * @param {any} sub The current subscription data.
   * @param {Date} now The current date.
   * @param {Date} expiresAt The expiration date.
   * @param {string} subscriptionDocId Firestore subscription document id.
   * @return {Promise<void>}
   */
  private static async handleExpiryAlert(
    businessId: string,
    sub: any,
    now: Date,
    expiresAt: Date,
    subscriptionDocId: string,
  ) {
    const daysUntil = Math.ceil(
      (expiresAt.getTime() - now.getTime()) / (1000 * 60 * 60 * 24),
    );
    if (daysUntil === 7 && !sub.dates?.lastExpiryAlert) {
      try {
        await NotificationService.broadcastToBusiness(businessId, {
          title: "Subscription Expiring Soon",
          message: `Your ${sub.planName} plan expires in 7 days. Renew now to maintain access.`,
          type: "warning",
        });

        // Mark as alerted
        const docRef = db
          .collection("businesses")
          .doc(businessId)
          .collection("subscriptions")
          .doc(subscriptionDocId);
        await docRef.update({
          "dates.lastExpiryAlert": FieldValue.serverTimestamp(),
        });
      } catch (error) {
        logger.error(
          `Failed to send expiry alert for business ${businessId}`,
          error,
        );
      }
    }
  }
}
