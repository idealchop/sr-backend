import { db, FieldValue } from "../../config/firebase-admin";
import { normalizePaymentAccountType } from "../../utils/payment-account-type";
import { logAuditEvent, logger } from "../observability/logging/logger";
import { syncGettingStartedOnBusiness } from "./getting-started-sync-service";

export type OnboardingPaymentAccountDraft = {
  bankName: string;
  accountName: string;
  accountNumber: string;
  type: "bank_transfer" | "credit_card" | "digital_wallet";
  isPrimary?: boolean;
  qrCode?: string;
};

function sanitizeQrCode(raw: unknown): string {
  if (typeof raw !== "string") return "";
  const url = raw.trim();
  if (!url || url.startsWith("data:")) return "";
  return url;
}

/**
 * Parses onboarding payment drafts. Skips blank rows; requires provider plus
 * account name or number (same rules as POST /business/payment-info).
 * @param {unknown} raw `config.paymentAccounts` from POST /onboarding/complete.
 * @return {OnboardingPaymentAccountDraft[]} Normalized accounts to seed.
 */
export function parseOnboardingPaymentAccounts(
  raw: unknown,
): OnboardingPaymentAccountDraft[] {
  if (!Array.isArray(raw)) return [];

  const accounts: OnboardingPaymentAccountDraft[] = [];
  for (const item of raw) {
    if (!item || typeof item !== "object") continue;
    const rec = item as Record<string, unknown>;
    const bankName = typeof rec.bankName === "string" ? rec.bankName.trim() : "";
    const accountName =
      typeof rec.accountName === "string" ? rec.accountName.trim() : "";
    const accountNumber =
      typeof rec.accountNumber === "string" ? rec.accountNumber.trim() : "";
    if (!bankName || (!accountName && !accountNumber)) continue;
    accounts.push({
      bankName,
      accountName,
      accountNumber,
      type: normalizePaymentAccountType(rec.type, bankName),
      isPrimary: Boolean(rec.isPrimary),
      qrCode: sanitizeQrCode(rec.qrCode),
    });
  }

  if (accounts.length > 0 && !accounts.some((account) => account.isPrimary)) {
    accounts[0].isPrimary = true;
  }

  return accounts;
}

/**
 * Seeds `payment_info` after onboarding when the collection is empty.
 * @param {Object} params Business, owner, and parsed accounts.
 * @return {Promise<number>} Number of documents written.
 */
export async function seedOnboardingPaymentInfo(params: {
  businessId: string;
  userId: string;
  accounts: OnboardingPaymentAccountDraft[];
}): Promise<number> {
  const { businessId, userId, accounts } = params;
  if (accounts.length === 0) return 0;

  const col = db
    .collection("businesses")
    .doc(businessId)
    .collection("payment_info");
  const existing = await col.limit(1).get();
  if (!existing.empty) return 0;

  const batch = db.batch();
  const persisted: Array<{ id: string } & OnboardingPaymentAccountDraft> = [];

  for (const account of accounts) {
    const ref = col.doc();
    const row = {
      qrCode: account.qrCode || "",
      bankName: account.bankName,
      accountName: account.accountName,
      accountNumber: account.accountNumber,
      type: account.type,
      isPrimary: Boolean(account.isPrimary),
    };
    batch.set(ref, {
      ...row,
      createdAt: FieldValue.serverTimestamp(),
      updatedAt: FieldValue.serverTimestamp(),
    });
    persisted.push({ id: ref.id, ...row });
  }

  await batch.commit();

  for (const row of persisted) {
    try {
      await logAuditEvent(
        "PAYMENT_INFO_ADDED",
        {
          businessId,
          userId,
          paymentId: row.id,
          source: "onboarding",
        },
        null,
        {
          bankName: row.bankName,
          accountName: row.accountName,
          accountNumber: row.accountNumber,
          type: row.type,
          isPrimary: row.isPrimary,
        },
      );
    } catch (auditErr) {
      logger.warn("onboarding payment audit failed", {
        businessId,
        paymentId: row.id,
        err: auditErr instanceof Error ? auditErr.message : String(auditErr),
      });
    }
  }

  try {
    await syncGettingStartedOnBusiness(businessId);
  } catch (syncErr) {
    logger.warn("getting-started sync after onboarding payment seed failed", {
      businessId,
      err: syncErr instanceof Error ? syncErr.message : String(syncErr),
    });
  }

  return persisted.length;
}
