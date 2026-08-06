import { db, FieldValue } from "../../config/firebase-admin";
import { logger } from "../observability/logging/logger";

/** Max scheduled auto AI tool runs (Gemini) per business per Manila day. */
export const MAX_AUTO_AI_TOOLS_PER_BUSINESS_PER_DAY = 2;

/**
 * Atomically consumes one auto-AI slot for the business/date.
 * Returns false when the daily cap is already reached.
 */
export async function tryConsumeAutoAiToolSlot(
  businessId: string,
  dateKey: string,
): Promise<boolean> {
  const businessRef = db.collection("businesses").doc(businessId);

  const allowed = await db.runTransaction(async (tx) => {
    const snap = await tx.get(businessRef);
    if (!snap.exists) return false;
    const data = snap.data() ?? {};
    const storedDate =
      typeof data.autoAiToolsBudgetDate === "string" ?
        data.autoAiToolsBudgetDate :
        "";
    const storedCount =
      typeof data.autoAiToolsBudgetCount === "number" &&
      Number.isFinite(data.autoAiToolsBudgetCount) ?
        Math.max(0, Math.floor(data.autoAiToolsBudgetCount)) :
        0;

    const count = storedDate === dateKey ? storedCount : 0;
    if (count >= MAX_AUTO_AI_TOOLS_PER_BUSINESS_PER_DAY) {
      return false;
    }

    tx.set(
      businessRef,
      {
        autoAiToolsBudgetDate: dateKey,
        autoAiToolsBudgetCount: count + 1,
        updatedAt: FieldValue.serverTimestamp(),
      },
      { merge: true },
    );
    return true;
  });

  if (!allowed) {
    logger.info("auto_ai_tool_budget_exhausted", {
      businessId,
      dateKey,
      max: MAX_AUTO_AI_TOOLS_PER_BUSINESS_PER_DAY,
    });
  }
  return allowed;
}
