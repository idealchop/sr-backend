import { db, FieldValue } from "../../config/firebase-admin";

export type CheckoutVoucherResult =
  | { valid: false; message: string }
  | {
      valid: true;
      discountAmount: number;
      discountType: string;
      voucherId: string;
      message: string;
    };

function asDate(value: unknown): Date | null {
  if (!value) return null;
  if (value instanceof Date) return value;
  if (typeof value === "object" && value !== null && "toDate" in value) {
    return (value as { toDate: () => Date }).toDate();
  }
  if (typeof value === "string") return new Date(value);
  if (typeof value === "object" && value !== null && "seconds" in value) {
    return new Date(Number((value as { seconds: number }).seconds) * 1000);
  }
  return null;
}

export function evaluateCheckoutVoucher(input: {
  voucher: Record<string, unknown>;
  voucherId: string;
  planCode: string;
  billingCycle: string;
  subtotal: number;
  now?: Date;
}): CheckoutVoucherResult {
  const v = input.voucher;
  const subtotal = Number(input.subtotal);
  if (!Number.isFinite(subtotal) || subtotal < 0) {
    return { valid: false, message: "Invalid subtotal." };
  }
  if (v.isActive === false) {
    return { valid: false, message: "This voucher is inactive." };
  }

  const now = input.now ?? new Date();
  const from = asDate(v.validFrom);
  const until = asDate(v.validUntil);
  if (from && now < from) {
    return { valid: false, message: "This voucher is not active yet." };
  }
  if (until && now > until) {
    return { valid: false, message: "This voucher has expired." };
  }

  let planCodes: string[] = [];
  if (Array.isArray(v.applicablePlanCodes)) {
    planCodes = v.applicablePlanCodes.map((c) => String(c).toLowerCase());
  }
  const planCode = String(input.planCode || "").toLowerCase();
  if (planCodes.length > 0 && (!planCode || !planCodes.includes(planCode))) {
    return {
      valid: false,
      message: "This voucher does not apply to your selected plan.",
    };
  }

  let cycles: string[] = [];
  if (Array.isArray(v.applicableBillingCycles)) {
    cycles = v.applicableBillingCycles.map(String);
  }
  if (cycles.length > 0 && !cycles.includes(input.billingCycle)) {
    return {
      valid: false,
      message: "This voucher does not apply to this billing cycle.",
    };
  }

  const minSub = typeof v.minSubtotal === "number" ? v.minSubtotal : null;
  if (minSub !== null && subtotal < minSub) {
    return {
      valid: false,
      message: `Minimum subtotal of ₱${minSub.toLocaleString()} required for this voucher.`,
    };
  }

  const maxRed = typeof v.maxRedemptions === "number" ? v.maxRedemptions : null;
  const used = typeof v.redemptionCount === "number" ? v.redemptionCount : 0;
  if (maxRed !== null && used >= maxRed) {
    return {
      valid: false,
      message: "This voucher has reached its redemption limit.",
    };
  }

  const dtype = String(v.discountType || "fixed_amount");
  const dval = Number(v.discountValue) || 0;
  let discountAmount = 0;
  if (dtype === "percentage") {
    discountAmount = Math.floor((subtotal * dval) / 100);
  } else if (dtype === "fixed_amount") {
    discountAmount = Math.min(dval, subtotal);
  } else {
    return { valid: false, message: "Unsupported discount type." };
  }

  return {
    valid: true,
    discountAmount,
    discountType: dtype,
    voucherId: input.voucherId,
    message: "Voucher applied.",
  };
}

export async function loadCheckoutVoucherByCode(
  code: string,
): Promise<{ id: string; data: Record<string, unknown> } | null> {
  const normalized = String(code || "").trim().toUpperCase();
  if (!normalized) return null;
  const q = await db
    .collection("vouchers_affiliates")
    .where("kind", "==", "voucher")
    .where("code", "==", normalized)
    .limit(1)
    .get();
  if (q.empty) return null;
  return { id: q.docs[0].id, data: q.docs[0].data() as Record<string, unknown> };
}

export async function validateStoredCheckoutVoucher(input: {
  code: string;
  planCode: string;
  billingCycle: string;
  subtotal: number;
}): Promise<CheckoutVoucherResult> {
  const code = String(input.code || "").trim().toUpperCase();
  if (!code) return { valid: false, message: "Code is required." };
  const row = await loadCheckoutVoucherByCode(code);
  if (!row) return { valid: false, message: "This code is not valid." };
  return evaluateCheckoutVoucher({
    voucher: row.data,
    voucherId: row.id,
    planCode: input.planCode,
    billingCycle: input.billingCycle,
    subtotal: input.subtotal,
  });
}

export async function incrementVoucherRedemption(voucherId: string): Promise<void> {
  const id = String(voucherId || "").trim();
  if (!id) return;
  await db.collection("vouchers_affiliates").doc(id).update({
    redemptionCount: FieldValue.increment(1),
  });
}

/** Amount due after a valid voucher. PayMongo cannot charge ₱0. */
export function amountDueAfterVoucher(
  subtotal: number,
  discountAmount: number,
): number {
  return Math.max(0, (Number(subtotal) || 0) - (Number(discountAmount) || 0));
}
