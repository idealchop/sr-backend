import { Request, Response } from "express";
import { db, FieldValue } from "../../config/firebase-admin";
import { logAuditSummary } from "../../services/observability/logging/logger";
import {
  CustomerActiveLimitError,
  CustomerActiveLimitService,
} from "../../services/customers/customer-active-limit-service";
import { CustomerService } from "../../services/customers/customer-service";
import {
  ensureCustomerActiveForPortalAcceptance,
  PortalCustomerActivationBlockedError,
} from "../../services/portal/portal-customer-activation";
import { TransactionService } from "../../services/transactions/transaction-service";
import { RawSubmissionProcessor } from "../../services/portal/raw-submission-processor";
import { OnlineOrderLimitService } from "../../services/portal/online-order-limit-service";
import {
  computeStockCheckPreview,
  RawSubmissionService,
} from "../../services/portal/raw-submission-service";
import type { RawSubmission } from "../../services/portal/raw-submission-types";
import {
  listPortalProfileChanges,
  summarizePortalProfileChanges,
} from "../../services/portal/portal-profile-diff";
import {
  notifyPortalSubmissionFulfilled,
  notifyPortalSukiIdentified,
  notifyPortalSukiRegistered,
} from "../../services/notifications/station-activity-notification-service";

async function respondIfBeyondOnlineOrderLimit(
  res: Response,
  businessId: string,
  submission: RawSubmission | null,
): Promise<boolean> {
  if (!submission) return false;
  const canAccess = await OnlineOrderLimitService.staffCanAccessSubmission(
    businessId,
    submission,
  );
  if (!canAccess) {
    res.status(403).json({
      error:
        "This portal order exceeds your plan limit. Upgrade to view and process it.",
      code: "OVER_ONLINE_ORDER_LIMIT",
    });
    return true;
  }
  return false;
}

function respondIfPortalCustomerLimitError(res: Response, error: unknown): boolean {
  if (error instanceof PortalCustomerActivationBlockedError) {
    res.status(403).json({
      error: "CUSTOMER_ACTIVE_LIMIT_EXCEEDED",
      message: error.message,
      activeCount: error.activeCount,
      cap: error.cap,
    });
    return true;
  }
  if (error instanceof CustomerActiveLimitError) {
    res.status(403).json({
      error: error.code,
      message: error.message,
      activeCount: error.activeCount,
      cap: error.cap,
    });
    return true;
  }
  return false;
}

function getDistance(lat1: number, lon1: number, lat2: number, lon2: number) {
  const R = 6371e3; // meters
  const φ1 = (lat1 * Math.PI) / 180;
  const φ2 = (lat2 * Math.PI) / 180;
  const Δφ = ((lat2 - lat1) * Math.PI) / 180;
  const Δλ = ((lon2 - lon1) * Math.PI) / 180;

  const a =
    Math.sin(Δφ / 2) * Math.sin(Δφ / 2) +
    Math.cos(φ1) * Math.cos(φ2) * Math.sin(Δλ / 2) * Math.sin(Δλ / 2);
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));

  return R * c;
}

/**
 * Minimum score before we show "Existing Suki match" (primary); below this,
 * treat as new suki with optional ranked picks.
 */
const MIN_SCORE_FOR_PRIMARY_MATCH = 46;

function normalizeDigits(value: unknown): string {
  return String(value ?? "").replace(/\D/g, "");
}

function normalizeEmail(value: unknown): string {
  return String(value ?? "")
    .trim()
    .toLowerCase();
}

function normalizeName(value: unknown): string {
  return String(value ?? "")
    .toLowerCase()
    .replace(/\s+/g, " ")
    .trim();
}

/**
 * Tokens of length >= minLen (letters/digits only) for conservative address overlap.
 * @param {string} text
 * @param {number} minLen
 * @return {Set<string>}
 */
function meaningfulTokens(text: string, minLen: number): Set<string> {
  const out = new Set<string>();
  const norm = text.toLowerCase().replace(/\s+/g, " ").trim();
  if (!norm) return out;
  for (const raw of norm.split(/[\s,.#/|-]+/)) {
    const t = raw.replace(/[^a-z0-9]/gi, "");
    if (t.length >= minLen) out.add(t);
  }
  return out;
}

function nameMatchScore(subName: string, custName: string): number {
  if (!subName || !custName) return 0;
  if (subName === custName) return 50;

  const subWords = new Set(subName.split(" ").filter((w) => w.length >= 3));
  const custWords = new Set(custName.split(" ").filter((w) => w.length >= 3));
  let shared = 0;
  for (const w of subWords) {
    if (custWords.has(w)) shared++;
  }
  if (shared >= 2) return 28;
  if (shared === 1) return 12;

  // Guarded substring: avoid "a" in "church" style false positives
  if (subName.length >= 4 && custName.length >= 4) {
    const shorter = Math.min(subName.length, custName.length);
    const longer = Math.max(subName.length, custName.length);
    if (
      shorter >= 4 &&
      longer >= 5 &&
      (custName.includes(subName) || subName.includes(custName))
    ) {
      if (shorter / longer >= 0.55) return 14;
    }
  }
  return 0;
}

function addressOverlapScore(line: string, custAddr: string): number {
  const a = meaningfulTokens(line, 4);
  const b = meaningfulTokens(custAddr, 4);
  if (a.size === 0 || b.size === 0) return 0;
  let overlap = 0;
  for (const t of a) {
    if (b.has(t)) overlap++;
  }
  if (overlap >= 2) return 14;
  if (overlap === 1) return 7;
  return 0;
}

/**
 * Score a candidate customer against the submission profile/address.
 * Higher = better match. Used to return top-5 candidates.
 * Conservative: weak geo + type + fuzzy address must not alone imply a "match".
 *
 * @param {*} candidate The candidate.
 * @param {*} profile The submitted profile.
 * @param {*} addr The address.
 * @return {number} The match score.
 */
function scoreCandidate(
  candidate: Awaited<ReturnType<typeof CustomerService.getCustomer>>,
  profile: Record<string, any>,
  addr: { line?: string; latitude?: number; longitude?: number },
): number {
  if (!candidate) return 0;
  let score = 0;

  const subName = normalizeName(profile.name);
  const custName = normalizeName(candidate.name);
  score += nameMatchScore(subName, custName);

  const pPhone = normalizeDigits(profile.phone);
  const cPhone = normalizeDigits(candidate.phone);
  if (pPhone.length >= 8 && cPhone.length >= 8 && pPhone === cPhone) {
    score += 48;
  }

  const pEmail = normalizeEmail(profile.email);
  const cEmail = normalizeEmail(candidate.email);
  if (pEmail.length > 3 && cEmail.length > 3 && pEmail === cEmail) {
    score += 48;
  }

  const lat = addr.latitude;
  const lng = addr.longitude;
  const clat = candidate.latitude;
  const clng = candidate.longitude;
  if (
    lat != null &&
    lng != null &&
    clat != null &&
    clng != null &&
    !Number.isNaN(Number(lat)) &&
    !Number.isNaN(Number(lng)) &&
    !Number.isNaN(Number(clat)) &&
    !Number.isNaN(Number(clng))
  ) {
    const dist = getDistance(
      Number(lat),
      Number(lng),
      Number(clat),
      Number(clng),
    );
    if (dist <= 35) score += 24;
    else if (dist <= 120) score += 14;
    else if (dist <= 350) score += 6;
  }

  if (addr.line && candidate.address) {
    score += addressOverlapScore(String(addr.line), String(candidate.address));
  }

  const subType =
    profile.sukiType === "commercial" ? "commercial" : "residential";
  if (candidate.type === subType) score += 2;

  return score;
}

export const listPendingSubmissions = async (req: Request, res: Response) => {
  const { businessId } = req.params;
  try {
    const items = await RawSubmissionService.listByStatus(
      businessId,
      "pending_review",
      100,
    );
    // Subcollection is already scoped by path; keep only rows stamped for this business.
    const scoped = items.filter(
      (s) => !s.businessId || s.businessId === businessId,
    );
    res.json({ data: scoped });
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: "Failed to list submissions" });
  }
};

export const getSubmissionDetail = async (req: Request, res: Response) => {
  const { businessId, submissionId } = req.params;
  try {
    const submission = await RawSubmissionService.getOne(
      businessId,
      submissionId,
    );
    if (!submission) return res.status(404).json({ error: "Not found" });
    if (await respondIfBeyondOnlineOrderLimit(res, businessId, submission)) return;

    let currentCustomer = null;
    let candidateCustomers: Awaited<
      ReturnType<typeof CustomerService.getCustomer>
    >[] = [];

    if (submission.customerId) {
      // Already linked — just resolve that customer
      currentCustomer = await CustomerService.getCustomer(
        businessId,
        submission.customerId,
      );
    } else {
      // Smart matching — return top-5 ranked candidates
      const allCustomers =
        await CustomerService.getCustomersByBusiness(businessId);
      const profile = submission.payload.profile || {};
      const addr = submission.payload.address || {};

      const scored = allCustomers
        .map((c) => ({ customer: c, score: scoreCandidate(c, profile, addr) }))
        .filter((x) => x.score > 0)
        .sort((a, b) => b.score - a.score);

      const top = scored.slice(0, 5).map((x) => x.customer);
      candidateCustomers = top;
      const best = scored[0];
      currentCustomer =
        best && best.score >= MIN_SCORE_FOR_PRIMARY_MATCH ?
          best.customer :
          null;
    }

    const stockCheckPreview =
      submission.submissionType === "PLACE_ORDER" ?
        await computeStockCheckPreview(businessId, submission.payload) :
        submission.stockCheckPreview || { ok: true, messages: [] };

    let linkedTransaction: {
      totalAmount?: number;
      balanceDue?: number;
      serviceRating?: number;
      riderRating?: number;
      feedback?: string;
      riderName?: string;
    } | null = null;

    const txDocId = String(submission.payload.targetTransactionId || "").trim();
    if (
      txDocId &&
      (submission.submissionType === "MARK_TX_COMPLETE" ||
        submission.submissionType === "PORTAL_PAY_BALANCE")
    ) {
      const tx = await TransactionService.getTransaction(businessId, txDocId);
      if (tx) {
        linkedTransaction = {
          totalAmount: tx.totalAmount,
          balanceDue: tx.balanceDue,
          serviceRating: tx.serviceRating ?? tx.rating,
          riderRating: tx.riderRating,
          feedback: tx.feedback,
          riderName: tx.riderName,
        };
      }
    }

    res.json({
      data: {
        submission: { ...submission, stockCheckPreview },
        currentCustomer,
        candidateCustomers,
        linkedTransaction,
      },
    });
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: "Failed to load submission" });
  }
};

export const acceptSubmission = async (req: Request, res: Response) => {
  const { businessId, submissionId } = req.params;
  const user = (req as any).user;
  const force = req.query.force === "true";

  // Owner may pass adjusted quantities/prices before accepting
  const adjustedPayload = req.body?.adjustedPayload ?? null;

  try {
    const submission = await RawSubmissionService.getOne(
      businessId,
      submissionId,
    );
    if (!submission || submission.status !== "pending_review") {
      return res.status(404).json({ error: "Not found or already processed" });
    }
    if (await respondIfBeyondOnlineOrderLimit(res, businessId, submission)) return;

    // Merge owner adjustments into the submission payload before processing
    const effectiveSubmission = adjustedPayload ?
      {
        ...submission,
        payload: { ...submission.payload, ...adjustedPayload },
      } :
      submission;

    if (effectiveSubmission.submissionType === "PLACE_ORDER") {
      const check = await computeStockCheckPreview(
        businessId,
        effectiveSubmission.payload,
      );
      if (!check.ok && !force) {
        return res.status(400).json({
          error: "INSUFFICIENT_STOCK",
          stockCheckPreview: check,
        });
      }
    }

    await RawSubmissionProcessor.accept(
      businessId,
      effectiveSubmission,
      user.uid,
    );

    const summary =
      `Accepted ${submission.submissionType} for ${submission.customerId}`.slice(
        0,
        100,
      );
    await logAuditSummary("RAW_SUBMISSION_ACCEPTED", businessId, summary, {
      submissionId,
      customerId: submission.customerId,
      userId: user.uid,
    });

    let transactionId: string | undefined;
    if (effectiveSubmission.payload?.type === "walkin") {
      const refId = String(submission.referenceId || "").trim();
      if (refId) {
        const snap = await db
          .collection("businesses")
          .doc(businessId)
          .collection("transactions")
          .where("referenceId", "==", refId)
          .limit(1)
          .get();
        transactionId = snap.docs[0]?.id;
      }
    }

    res.json({ success: true, ...(transactionId ? { transactionId } : {}) });
  } catch (error: any) {
    console.error(error);
    if (respondIfPortalCustomerLimitError(res, error)) return;
    res.status(500).json({ error: error?.message || "Accept failed" });
  }
};

export const cancelSubmission = async (req: Request, res: Response) => {
  const { businessId, submissionId } = req.params;
  const user = (req as any).user;
  const reason =
    typeof req.body?.reason === "string" ? req.body.reason.trim() : "";

  if (!reason || reason.length < 3) {
    return res
      .status(400)
      .json({ error: "A cancellation reason (min 3 characters) is required." });
  }

  try {
    const submission = await RawSubmissionService.getOne(
      businessId,
      submissionId,
    );
    if (!submission || submission.status !== "pending_review") {
      return res.status(404).json({ error: "Not found or already processed" });
    }
    if (await respondIfBeyondOnlineOrderLimit(res, businessId, submission)) return;

    await RawSubmissionProcessor.cancelPending(
      businessId,
      submissionId,
      user.uid,
      reason,
    );

    const summary =
      `Cancelled ${submission.submissionType} ${submissionId}`.slice(0, 100);
    await logAuditSummary("RAW_SUBMISSION_CANCELLED", businessId, summary, {
      submissionId,
      userId: user.uid,
      reason,
    });

    res.json({ success: true });
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: "Cancel failed" });
  }
};

/**
 * Marks a portal submission as processed after staff recorded the matching
 * transaction manually (no duplicate transaction on the server).
 *
 * @param {Request} req The express request
 * @param {Response} res The express response
 * @param {string} req.params.businessId - Business id.
 * @param {string} req.params.submissionId - Raw submission id.
 * @param {string} req.body.transactionId - Optional canonical transaction id.
 */
export const markSubmissionFulfilled = async (req: Request, res: Response) => {
  const { businessId, submissionId } = req.params;
  const user = (req as any).user;
  const rawTxId = req.body?.transactionId;
  const transactionId = typeof rawTxId === "string" ? rawTxId.trim() : "";

  try {
    const submission = await RawSubmissionService.getOne(
      businessId,
      submissionId,
    );
    if (!submission || submission.status !== "pending_review") {
      return res.status(404).json({ error: "Not found or already processed" });
    }
    if (await respondIfBeyondOnlineOrderLimit(res, businessId, submission)) return;

    await RawSubmissionService.updateStatus(businessId, submissionId, {
      status: "processed",
      processedAt: FieldValue.serverTimestamp() as any,
      processedByUid: user.uid,
    });

    if (transactionId) {
      const customer = submission.customerId ?
        await CustomerService.getCustomer(businessId, submission.customerId) :
        null;
      void notifyPortalSubmissionFulfilled(
        businessId,
        {
          submissionId,
          submissionType: submission.submissionType,
          customerId: submission.customerId || "",
          customerName: customer?.name || "Customer",
          referenceId: submission.referenceId || "",
          transactionId,
          portalOrderKind: submission.metadata?.portalOrderKind,
          portalCustomerStatus:
            submission.metadata?.customerRegisteredAt != null ?
              "new" :
              submission.customerId ?
                "recognized" :
                "new",
        },
        user.uid,
      ).catch((err) =>
        console.error("notifyPortalSubmissionFulfilled failed", err),
      );
    }

    const txInfo = transactionId ? ` · linked ${transactionId}` : "";
    const summary =
      `Portal submission closed as fulfilled (${submissionId})${txInfo}`.slice(
        0,
        100,
      );
    await logAuditSummary(
      "RAW_SUBMISSION_MARKED_FULFILLED",
      businessId,
      summary,
      {
        submissionId,
        userId: user.uid,
        transactionId: transactionId || undefined,
      },
    );

    res.json({ success: true });
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: "Mark fulfilled failed" });
  }
};

export const linkSubmissionCustomer = async (req: Request, res: Response) => {
  const { businessId, submissionId } = req.params;
  const { customerId } = req.body;
  try {
    const submission = await RawSubmissionService.getOne(
      businessId,
      submissionId,
    );
    if (!submission) return res.status(404).json({ error: "Not found" });
    if (await respondIfBeyondOnlineOrderLimit(res, businessId, submission)) return;

    const customer = await CustomerService.getCustomer(businessId, customerId);
    if (!customer) {
      return res.status(404).json({ error: "Customer not found" });
    }

    await ensureCustomerActiveForPortalAcceptance(businessId, customer);

    await RawSubmissionService.updateStatus(businessId, submissionId, {
      customerId,
    });
    res.json({ success: true });
  } catch (error) {
    console.error(error);
    if (respondIfPortalCustomerLimitError(res, error)) return;
    res.status(500).json({ error: "Failed to link customer" });
  }
};

/**
 * Merges portal submission profile/address onto a matched customer and links the
 * submission to that customer when it was previously anonymous. Does not create
 * a transaction — use accept after staff confirms.
 * @param {Request} req The express request
 * @param {Response} res The express response
 */
export const mergeSubmissionProfileToCustomer = async (
  req: Request,
  res: Response,
) => {
  const { businessId, submissionId } = req.params;
  const user = (req as any).user;
  const bodyId =
    typeof req.body?.customerId === "string" ? req.body.customerId.trim() : "";

  try {
    const submission = await RawSubmissionService.getOne(
      businessId,
      submissionId,
    );
    if (!submission || submission.status !== "pending_review") {
      return res.status(404).json({ error: "Not found or already processed" });
    }
    if (await respondIfBeyondOnlineOrderLimit(res, businessId, submission)) return;

    const existing = (submission.customerId || "").trim();
    const targetId = existing || bodyId;
    if (!targetId) {
      return res
        .status(400)
        .json({ error: "customerId is required if not linked." });
    }
    if (existing && bodyId && existing !== bodyId) {
      return res
        .status(400)
        .json({ error: "customerId does not match linked customer." });
    }

    const customer = await CustomerService.getCustomer(businessId, targetId);
    if (!customer) {
      return res.status(404).json({ error: "Customer not found" });
    }

    const profile = (submission.payload.profile || {}) as Record<
      string,
      unknown
    >;
    const addr = submission.payload.address || {};
    const updates: Record<string, unknown> = {};

    if (profile.name) updates.name = profile.name;
    if (profile.phone) updates.phone = profile.phone;
    if (profile.email) updates.email = profile.email;
    if (profile.sukiType === "commercial") {
      updates.type = "commercial";
      if (profile.companyName) updates.companyName = profile.companyName;
    } else if (profile.sukiType === "personal") {
      updates.type = "residential";
    }
    if (addr.line) updates.address = addr.line;
    if (addr.latitude !== undefined) updates.latitude = addr.latitude;
    if (addr.longitude !== undefined) updates.longitude = addr.longitude;

    if (Object.keys(updates).length > 0) {
      await CustomerService.updateCustomer(
        businessId,
        targetId,
        updates as any,
      );
    }

    const changedSummary = summarizePortalProfileChanges(
      listPortalProfileChanges(customer, submission.payload),
    );

    const refreshed =
      (await CustomerService.getCustomer(businessId, targetId)) ?? customer;
    await ensureCustomerActiveForPortalAcceptance(businessId, refreshed);

    if (!existing) {
      await RawSubmissionService.updateStatus(businessId, submissionId, {
        customerId: targetId,
      });
    }

    await RawSubmissionService.markProfileMergedToCustomer(
      businessId,
      submissionId,
    );

    void notifyPortalSukiIdentified(
      businessId,
      {
        submissionId,
        customerId: targetId,
        customerName: refreshed.name || customer.name || "Customer",
        referenceId: submission.referenceId || "",
        ...(changedSummary ? { changedSummary } : {}),
      },
      user.uid,
    ).catch((err) => console.error("notifyPortalSukiIdentified failed", err));

    const summary = `Merged portal profile to customer ${targetId}`.slice(
      0,
      100,
    );
    await logAuditSummary(
      "RAW_SUBMISSION_PROFILE_MERGED",
      businessId,
      summary,
      {
        submissionId,
        customerId: targetId,
        userId: user.uid,
      },
    );

    res.json({ success: true, customerId: targetId });
  } catch (error) {
    console.error(error);
    if (respondIfPortalCustomerLimitError(res, error)) return;
    res.status(500).json({ error: "Failed to merge profile to customer" });
  }
};

/**
 * Creates a new customer from the portal submission profile, links the submission,
 * and stamps metadata for track-order copy. Does not create a transaction — staff
 * uses Proceed with transaction next (same as merge-profile flow).
 * @param {Request} req The express request
 * @param {Response} res The express response
 */
export const registerNewSukiFromSubmission = async (
  req: Request,
  res: Response,
) => {
  const { businessId, submissionId } = req.params;
  const user = (req as any).user;

  try {
    const submission = await RawSubmissionService.getOne(
      businessId,
      submissionId,
    );
    if (!submission || submission.status !== "pending_review") {
      return res.status(404).json({ error: "Not found or already processed" });
    }
    if (await respondIfBeyondOnlineOrderLimit(res, businessId, submission)) return;

    if ((submission.customerId || "").trim()) {
      return res
        .status(400)
        .json({ error: "This submission already has a linked customer." });
    }

    const allowed = new Set(["PLACE_ORDER", "REQUEST_COLLECTION"]);
    if (!allowed.has(submission.submissionType)) {
      return res.status(400).json({
        error: "This submission type cannot register a new suki here.",
      });
    }

    const profile = (submission.payload.profile || {}) as Record<
      string,
      unknown
    >;
    const addr = submission.payload.address || {};
    const isWalkin = submission.payload?.type === "walkin";
    if (isWalkin) {
      return res.status(400).json({
        error:
          "Counter walk-in orders are recorded on the ledger only — no customer profile is saved.",
      });
    }
    const sukiType =
      profile.sukiType === "commercial" ? "commercial" : "residential";
    try {
      await CustomerActiveLimitService.assertCanAddActiveCustomer(businessId);
    } catch (limitErr) {
      if (limitErr instanceof CustomerActiveLimitError) {
        return res.status(403).json({
          error: limitErr.code,
          message: limitErr.message,
          activeCount: limitErr.activeCount,
          cap: limitErr.cap,
        });
      }
      throw limitErr;
    }
    const customer = await CustomerService.addCustomer(businessId, {
      name: (profile.name as string) || "New Suki",
      phone: (profile.phone as string) || "",
      email: (profile.email as string) || "",
      address: (addr.line as string) || "",
      latitude: addr.latitude != null ? Number(addr.latitude) : 0,
      longitude: addr.longitude != null ? Number(addr.longitude) : 0,
      type: sukiType,
      companyName:
        sukiType === "commercial" && typeof profile.companyName === "string" ?
          profile.companyName.trim() || undefined :
          undefined,
    });

    const newId = (customer.id || "").trim();
    if (!newId) {
      return res
        .status(500)
        .json({ error: "Customer was created but has no id." });
    }

    await RawSubmissionService.updateStatus(businessId, submissionId, {
      customerId: newId,
    });
    await RawSubmissionService.markCustomerRegisteredFromPortal(
      businessId,
      submissionId,
    );

    void notifyPortalSukiRegistered(
      businessId,
      {
        submissionId,
        customerId: newId,
        customerName: customer.name || "New suki",
        referenceId: submission.referenceId || "",
      },
      user.uid,
    ).catch((err) => console.error("notifyPortalSukiRegistered failed", err));

    const summary =
      `Registered new suki from portal submission ${submissionId}`.slice(
        0,
        100,
      );
    await logAuditSummary(
      "RAW_SUBMISSION_NEW_SUKI_REGISTERED",
      businessId,
      summary,
      {
        submissionId,
        customerId: newId,
        userId: user.uid,
      },
    );

    res.json({ success: true, customerId: newId });
  } catch (error) {
    console.error(error);
    if (respondIfPortalCustomerLimitError(res, error)) return;
    res.status(500).json({ error: "Failed to register new suki" });
  }
};
