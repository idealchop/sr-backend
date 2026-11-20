/** Seeded ledger fixtures + mutation helpers for materializer equivalence tests. */
import { fakeClock, fakeDb, FakeFieldValue, Timestamp, rawDoc } from "./fake-firestore";

export const BUSINESS_ID = "biz_test";
const DAY = 86_400_000;

function rng(seed: number): () => number {
  let s = seed >>> 0;
  return () => {
    s = (Math.imul(s, 1664525) + 1013904223) >>> 0;
    return s / 0x1_0000_0000;
  };
}

const bizPath = `businesses/${BUSINESS_ID}`;
export const txPath = (id: string) => `${bizPath}/transactions/${id}`;
export const customerPath = (id: string) => `${bizPath}/customers/${id}`;

function txRef(id: string) {
  return fakeDb.collection("businesses").doc(BUSINESS_ID).collection("transactions").doc(id);
}
function customerRef(id: string) {
  return fakeDb.collection("businesses").doc(BUSINESS_ID).collection("customers").doc(id);
}

const ts = (ms: number) => Timestamp.fromMillis(ms);

/**
 * Seeds a varied station: walk-ins, inactive and denormalized customers,
 * deliveries in every status, partial/voided payments, expenses, ratings,
 * legacy string and missing scheduledAt rows, and a customer with no createdAt.
 */
export async function seedStation(
  opts: { customers?: number; transactions?: number; seed?: number } = {},
) {
  const rand = rng(opts.seed ?? 42);
  const pick = <T>(arr: T[]): T => arr[Math.floor(rand() * arr.length)];
  const now = fakeClock.nowMs;
  const customerCount = opts.customers ?? 40;
  const txCount = opts.transactions ?? 400;

  await fakeDb.collection("businesses").doc(BUSINESS_ID).set({
    name: "Test Station",
    uiConfig: { dormantThresholdDays: 21 },
  });

  const customerIds: string[] = [];
  for (let i = 0; i < customerCount; i++) {
    const id = `c${String(i).padStart(3, "0")}`;
    customerIds.push(id);
    const data: Record<string, unknown> = {
      name: i === 0 ? "Walk-in Customer" : `Suki ${i}`,
      phone: `0917${String(i).padStart(7, "0")}`,
      status: i % 13 === 5 ? "inactive" : "active",
      updatedAt: ts(now - 30 * DAY),
    };
    if (i !== 7) data.createdAt = ts(now - (400 - i) * DAY);
    if (i % 4 === 0) data.healthScore = Math.round(rand() * 100);
    if (i % 6 === 1) {
      data.lastFulfilledAt = ts(now - Math.floor(rand() * 60) * DAY);
      data.lastFulfilledType = pick(["delivery", "collection", "direct_sale"]);
    }
    if (i === 3) data.createdAt = null;
    await customerRef(id).set(data);
  }

  for (let i = 0; i < txCount; i++) {
    const id = `t${String(i).padStart(4, "0")}`;
    const type = pick(["delivery", "delivery", "delivery", "walkin", "direct_sale", "collection", "expense"]);
    const ageDays = Math.floor(rand() * 420);
    const at = now - ageDays * DAY - Math.floor(rand() * DAY);
    const total = Math.round(rand() * 900 * 100) / 100 + 25;
    const data: Record<string, unknown> = {
      type,
      totalAmount: total,
      createdAt: ts(at),
      updatedAt: ts(at + 3_600_000),
      // Unused fields must not change results.
      notes: `note ${i}`,
      address: { line1: "Somewhere" },
    };
    if (i % 97 !== 3) data.scheduledAt = ts(at);
    if (i % 151 === 7) data.scheduledAt = new Date(at).toISOString();
    if (type !== "expense" || rand() < 0.3) data.customerId = pick(customerIds);
    if (type === "delivery" || type === "collection") {
      data.deliveryStatus = pick(["pending", "placed", "in-transit", "delivered", "completed", "cancelled", "Delivered", ""]);
      if (rand() < 0.4) data.deliveredAt = ts(at + 7_200_000);
    }
    const mode = rand();
    if (mode < 0.35) {
      const paid = Math.round(total * (rand() < 0.5 ? 1 : rand()) * 100) / 100;
      data.payments = [
        { amount: paid, date: ts(at + 1000), method: pick(["cash", "digital_wallet", "bank_transfer", undefined]), id: "p1" },
      ];
      if (rand() < 0.2) {
        (data.payments as unknown[]).push({ amount: 50, date: ts(at + 2 * DAY), method: "cash", voided: true });
      }
      data.amountPaid = paid;
      data.balanceDue = Math.max(0, total - paid);
      data.paymentStatus = paid >= total ? "paid" : "partial";
    } else if (mode < 0.7) {
      data.amountPaid = rand() < 0.5 ? total : 0;
      data.paymentMethod = pick(["cash", "digital_wallet", "other", undefined]);
      data.balanceDue = total - (data.amountPaid as number);
      data.paymentStatus = data.amountPaid ? "paid" : "unpaid";
    } else {
      data.balanceDue = total;
      data.paymentStatus = pick(["unpaid", "N/A", "partial"]);
    }
    if (rand() < 0.15) data.serviceRating = 1 + Math.floor(rand() * 5);
    if (rand() < 0.05) data.riderRating = "4";
    if (rand() < 0.5) data.waterRefills = [{ quantity: 1 + Math.floor(rand() * 6), productId: "x" }];
    if (rand() < 0.2) data.items = [{ quantity: 2, name: "cap" }];
    if (type === "collection" && rand() < 0.5) data.collectionItems = [{ qtyExpected: 3, qtyCollected: 2 }];
    for (const key of Object.keys(data)) if (data[key] === undefined) delete data[key];
    await txRef(id).set(data);
  }
  return { customerIds };
}

/** Writes like the app does: merge + server updatedAt. */
export async function writeTx(id: string, patch: Record<string, unknown>) {
  await txRef(id).set({ ...patch, updatedAt: FakeFieldValue.serverTimestamp() }, { merge: true });
}

export async function createTx(id: string, data: Record<string, unknown>) {
  await txRef(id).set({
    createdAt: FakeFieldValue.serverTimestamp(),
    scheduledAt: Timestamp.fromMillis(fakeClock.nowMs),
    ...data,
    updatedAt: FakeFieldValue.serverTimestamp(),
  });
}

export async function deleteTx(id: string) {
  await txRef(id).delete();
}

export async function writeCustomer(id: string, patch: Record<string, unknown>) {
  await customerRef(id).set(
    { ...patch, updatedAt: FakeFieldValue.serverTimestamp() },
    { merge: true },
  );
}

export function txData(id: string) {
  return rawDoc(txPath(id));
}
