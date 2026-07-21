import { db } from "../../config/firebase-admin";
import { isUnpaidReceivableTransaction } from "../../utils/unpaid-receivable";
import type { Transaction } from "./transaction-types";

/** True when the customer has at least one fulfilled unpaid/partial receivable. */
export async function customerHasUnpaidReceivable(
  businessId: string,
  customerId: string,
): Promise<boolean> {
  const col = db
    .collection("businesses")
    .doc(businessId)
    .collection("transactions");

  try {
    // Preferred: indexed customerId + balanceDue.
    const snap = await col
      .where("customerId", "==", customerId)
      .where("balanceDue", ">", 0)
      .orderBy("balanceDue", "desc")
      .limit(25)
      .get();

    return snap.docs.some((doc) =>
      isUnpaidReceivableTransaction({
        id: doc.id,
        ...(doc.data() as Transaction),
      }),
    );
  } catch {
    // Fallback when composite index is missing/building.
    const snap = await col.where("customerId", "==", customerId).limit(50).get();
    return snap.docs.some((doc) => {
      const data = doc.data() as Transaction;
      if (!(Number(data.balanceDue) > 0)) return false;
      return isUnpaidReceivableTransaction({ id: doc.id, ...data });
    });
  }
}
