import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../../../../config/firebase-admin", async () => {
  const fake = await import("./fake-firestore");
  return {
    db: fake.fakeDb,
    FieldValue: fake.FakeFieldValue,
    Timestamp: fake.Timestamp,
    auth: {},
    storage: {},
    appCheck: {},
  };
});

vi.mock("../../../../utils/analytics-daily-rollup", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../../../utils/analytics-daily-rollup")>();
  return { ...actual, ANALYTICS_MATERIALIZE_TX_LIMIT: 60 };
});

import {
  fakeClock,
  listDocs,
  rawDoc,
  readCounter,
  resetFakeFirestore,
  cloneStore,
  restoreStore,
} from "./fake-firestore";
import {
  BUSINESS_ID,
  createTx,
  deleteTx,
  seedStation,
  txData,
  writeCustomer,
  writeTx,
} from "./analytics-fixture";
import { legacyComputeSnapshot } from "./legacy-materialize-reference";
import {
  AnalyticsMaterializerService,
} from "../../../../services/analytics/analytics-materializer-service";
import { MATERIALIZE_COALESCE_WINDOW_MS } from
  "../../../../services/analytics/analytics-materialize-coalesce";
import { CustomerService } from "../../../../services/customers/customer-service";
import { TransactionService } from "../../../../services/transactions/transaction-service";
import { ANALYTICS_MATERIALIZE_TX_LIMIT } from "../../../../utils/analytics-daily-rollup";

const MIN = 60_000;
const snapshotPath = `businesses/${BUSINESS_ID}/analytics_snapshots/dashboard_kpis`;

function omit(doc: Record<string, unknown>, keys: string[]) {
  const rest = { ...doc };
  for (const key of keys) delete rest[key];
  return rest;
}

function strip(doc: Record<string, unknown> | undefined) {
  return doc ? omit(doc, ["computedAt", "reason", "version"]) : doc;
}

/** Legacy full recount: the exact reads + math the pre-change code ran. */
async function legacyFullRecount(now: Date) {
  const saved = cloneStore();
  const reads = readCounter.reads;
  const [business, customers, transactions] = await Promise.all([
    (await import("./fake-firestore")).fakeDb.collection("businesses").doc(BUSINESS_ID).get(),
    CustomerService.getCustomersByBusiness(BUSINESS_ID),
    TransactionService.getTransactionsByBusiness(BUSINESS_ID, {
      limit: ANALYTICS_MATERIALIZE_TX_LIMIT,
    }),
  ]);
  const legacyReads = readCounter.reads - reads;
  const uiConfig = business.data()?.uiConfig as { dormantThresholdDays?: number } | undefined;
  const raw = Number(uiConfig?.dormantThresholdDays);
  const thresholdDays = raw === 21 || raw === 30 ? raw : 15;
  const result = legacyComputeSnapshot(customers, transactions, thresholdDays, now);
  restoreStore(saved);
  readCounter.reads = reads;
  return { ...result, legacyReads };
}

/** Full recount through the new service on a scratch copy of the store. */
async function serviceFullRecountSnapshot(now: Date) {
  const saved = cloneStore();
  const reads = readCounter.reads;
  const writes = readCounter.writes;
  await AnalyticsMaterializerService.materialize(BUSINESS_ID, { mode: "full", reason: "ref", now });
  const doc = strip(rawDoc(snapshotPath));
  restoreStore(saved);
  readCounter.reads = reads;
  readCounter.writes = writes;
  return doc;
}

async function expectMatchesFullRecount(now: Date) {
  const legacy = await legacyFullRecount(now);
  const stored = strip(rawDoc(snapshotPath));
  expect(stored).toEqual(legacy.snapshot);
  expect(stored).toEqual(await serviceFullRecountSnapshot(now));

  // Every stored daily doc equals the recount; days that lost activity are zero.
  const daily = listDocs(`businesses/${BUSINESS_ID}/analytics_daily`);
  for (const { id, data } of daily) {
    const expected = legacy.dailyMap.get(id);
    const values = omit(data, ["computedAt", "version"]);
    // Capped window: days outside the in-memory 60-row window keep their
    // stored docs (same as the legacy recount), so only in-window days are asserted.
    if (expected) expect(values).toEqual(expected);
  }
  for (const key of legacy.dailyMap.keys()) {
    expect(daily.some((d) => d.id === key)).toBe(true);
  }
  return legacy;
}

/** One mutation → enqueue (outside the window so it runs inline) → rebuild. */
async function mutateAndRebuild(
  mutate: () => Promise<void>,
  opts: { deletedTransactionId?: string } = {},
) {
  fakeClock.nowMs += MATERIALIZE_COALESCE_WINDOW_MS + MIN;
  await mutate();
  const leaseId = await AnalyticsMaterializerService.enqueueMaterialize(BUSINESS_ID, {
    ...opts,
    nowMs: fakeClock.nowMs,
  });
  expect(leaseId).toBeTruthy();
  const before = readCounter.reads;
  const result = await AnalyticsMaterializerService.runLeasedMaterialize(
    BUSINESS_ID,
    leaseId as string,
    "mutate",
    fakeClock.nowMs,
  );
  return { result, reads: readCounter.reads - before };
}

describe("incremental equals full recount when the 8k window is capped (limit mocked to 60)", () => {
  beforeEach(async () => {
    resetFakeFirestore();
    fakeClock.nowMs = Date.UTC(2026, 10, 9, 4, 0, 0);
    await seedStation();
    await AnalyticsMaterializerService.materialize(BUSINESS_ID, {
      mode: "full",
      reason: "seed",
      now: new Date(fakeClock.nowMs),
    });
  });

  it("bootstrap full recount equals the legacy recount", async () => {
    await expectMatchesFullRecount(new Date(fakeClock.nowMs));
    expect(rawDoc(`businesses/${BUSINESS_ID}/analytics_state/meta`)).toMatchObject({
      version: 1,
      txCount: 400,
      customerCount: 40,
    });
    expect(rawDoc(snapshotPath)).toMatchObject({ coverageTxCount: 60 });
  });

  it("create / update / payment / void / delete / customer edits stay identical", async () => {
    const steps: { name: string; run: () => Promise<void>; deleted?: string }[] = [
      {
        name: "create pending delivery",
        run: () => createTx("new1", {
          type: "delivery", customerId: "c010", totalAmount: 180, deliveryStatus: "pending",
          balanceDue: 180, paymentStatus: "unpaid", waterRefills: [{ quantity: 4 }],
        }),
      },
      { name: "mark delivered", run: () => writeTx("new1", { deliveryStatus: "delivered" }) },
      {
        name: "partial payment",
        run: () => writeTx("new1", {
          payments: [{ amount: 100, date: new Date(fakeClock.nowMs), method: "cash" }],
          amountPaid: 100, balanceDue: 80, paymentStatus: "partial",
        }),
      },
      {
        name: "second (gcash) payment → paid",
        run: () => writeTx("new1", {
          payments: [
            { amount: 100, date: new Date(fakeClock.nowMs - 4 * MIN), method: "cash" },
            { amount: 80, date: new Date(fakeClock.nowMs), method: "digital_wallet" },
          ],
          amountPaid: 180, balanceDue: 0, paymentStatus: "paid",
        }),
      },
      {
        name: "void the gcash payment",
        run: () => writeTx("new1", {
          payments: [
            { amount: 100, date: new Date(fakeClock.nowMs - 8 * MIN), method: "cash" },
            { amount: 80, date: new Date(fakeClock.nowMs - 4 * MIN), method: "digital_wallet", voided: true },
          ],
          amountPaid: 100, balanceDue: 80, paymentStatus: "partial",
        }),
      },
      { name: "edit total on an old row", run: () => writeTx("t0005", { totalAmount: 999, balanceDue: 999 }) },
      {
        name: "backdated payment 40 days ago",
        run: () => writeTx("t0010", {
          payments: [{ amount: 75, date: new Date(fakeClock.nowMs - 40 * 86_400_000), method: "bank_transfer" }],
          amountPaid: 75,
        }),
      },
      {
        name: "cancel a delivery",
        run: async () => {
          const id = ["t0001", "t0002", "t0003", "t0004"].find((x) => txData(x)?.type === "delivery") ?? "t0001";
          await writeTx(id, { deliveryStatus: "cancelled" });
        },
      },
      { name: "expense", run: () => createTx("exp1", { type: "expense", totalAmount: 500, amountPaid: 500, paymentStatus: "paid" }) },
      { name: "walk-in sale", run: () => createTx("walk1", { type: "walkin", customerId: "c002", totalAmount: 60, amountPaid: 60, paymentStatus: "paid" }) },
      { name: "delete a row", run: () => deleteTx("t0020"), deleted: "t0020" },
      { name: "delete the new row", run: () => deleteTx("new1"), deleted: "new1" },
      { name: "customer goes inactive", run: () => writeCustomer("c011", { status: "inactive" }) },
      { name: "customer healthScore recompute", run: () => writeCustomer("c012", { healthScore: 12 }) },
      {
        name: "new customer + first order",
        run: async () => {
          await writeCustomer("c900", { name: "Fresh", status: "active", createdAt: new Date(fakeClock.nowMs) });
          await createTx("new2", { type: "direct_sale", customerId: "c900", totalAmount: 40, balanceDue: 40, paymentStatus: "unpaid" });
        },
      },
      { name: "rating added", run: () => writeTx("t0030", { serviceRating: 5 }) },
      { name: "dormant threshold changed", run: async () => {
        const { fakeDb } = await import("./fake-firestore");
        await fakeDb.collection("businesses").doc(BUSINESS_ID).set({ uiConfig: { dormantThresholdDays: 30 } }, { merge: true });
        await writeTx("t0031", { notes: "touch" });
      } },
    ];

    for (const step of steps) {
      const { result, reads } = await mutateAndRebuild(step.run, {
        deletedTransactionId: step.deleted,
      });
      expect(result?.path, step.name).toBe("incremental");
      expect(reads, step.name).toBeLessThan(60);
      await expectMatchesFullRecount(new Date(fakeClock.nowMs));
    }
  });

  it("falls back to a full recount when a row vanishes without a delete id", async () => {
    const { result } = await mutateAndRebuild(() => deleteTx("t0050"));
    expect(result?.path).toBe("full");
    expect(result?.fallbackReason).toBe("count_mismatch");
    await expectMatchesFullRecount(new Date(fakeClock.nowMs));
  });

  it("falls back to a full recount when state is missing", async () => {
    const { fakeDb } = await import("./fake-firestore");
    await fakeDb.collection("businesses").doc(BUSINESS_ID).collection("analytics_state").doc("meta").delete();
    const { result } = await mutateAndRebuild(() => writeTx("t0060", { totalAmount: 1 }));
    expect(result?.path).toBe("full");
    expect(result?.fallbackReason).toBe("state_missing");
    await expectMatchesFullRecount(new Date(fakeClock.nowMs));
  });

  it("does not touch the business doc on the mutation path", async () => {
    const before = JSON.stringify(rawDoc(`businesses/${BUSINESS_ID}`));
    await mutateAndRebuild(() => writeTx("t0070", { totalAmount: 5 }));
    expect(JSON.stringify(rawDoc(`businesses/${BUSINESS_ID}`))).toBe(before);
  });
});

