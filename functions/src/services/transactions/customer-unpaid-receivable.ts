import { db } from "../../config/firebase-admin";
import { isUnpaidReceivableTransaction } from "../../utils/unpaid-receivable";
import type { Transaction } from "./transaction-types";

/** True when the customer has at least one fulfilled unpaid/partial receivable. */
export async function customerHasUnpaidReceivable(
  businessId: string,
  customerId: string,
): Promise<boolean> {
  // Indexed: customerId + balanceDue. Scan a bounded page and filter fulfilled.
  const snap = await db
    .collection("businesses")
    .doc(businessId)
    .collection("transactions")
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
}
