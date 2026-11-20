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

import {
  FakeFieldValue,
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
  ANALYTICS_MATERIALIZE_QUEUE_COLLECTION,
  AnalyticsMaterializerService,
} from "../../../../services/analytics/analytics-materializer-service";
import { MATERIALIZE_COALESCE_WINDOW_MS } from
  "../../../../services/analytics/analytics-materialize-coalesce";
import { runProcessAnalyticsMaterializeQueue } from
  "../../../../jobs/process-analytics-materialize-queue";
import { CustomerService } from "../../../../services/customers/customer-service";
import { TransactionService } from "../../../../services/transactions/transaction-service";
import { ANALYTICS_MATERIALIZE_TX_LIMIT } from "../../../../utils/analytics-daily-rollup";

const MIN = 60_000;
const FakeDelete = FakeFieldValue.delete();
const snapshotPath = `businesses/${BUSINESS_ID}/analytics_snapshots/dashboard_kpis`;
const queuePath = `${ANALYTICS_MATERIALIZE_QUEUE_COLLECTION}/${BUSINESS_ID}`;

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
    if (expected) {
      expect(values).toEqual(expected);
    } else {
      expect(values).toMatchObject({
        revenueTotal: 0, revenueCash: 0, revenueOnline: 0,
        expensesTotal: 0, fulfilledCount: 0, paymentCount: 0,
      });
    }
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

describe("incremental analytics materialize equals a full recount", () => {
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

  it("legacy recount reads every customer + ledger row; incremental reads ~state + changes", async () => {
    const legacy = await legacyFullRecount(new Date(fakeClock.nowMs));
    // business + 39 customers with createdAt + 395 txs with scheduledAt
    expect(legacy.legacyReads).toBe(1 + 39 + 395);
    const { reads } = await mutateAndRebuild(() => writeTx("t0040", { totalAmount: 10 }));
    // meta + 20 shards + 2 change queries + business + 2 counts + queue doc reads.
    expect(reads).toBeLessThanOrEqual(35);
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

describe("randomized mutation fuzz (incremental == full recount after every step)", () => {
  for (const seed of [1, 2, 3, 4]) {
    it(`seed ${seed}`, async () => {
      resetFakeFirestore();
      fakeClock.nowMs = Date.UTC(2026, 10, 9, 4, 0, 0);
      await seedStation({ customers: 25, transactions: 150, seed });
      await AnalyticsMaterializerService.materialize(BUSINESS_ID, {
        mode: "full", reason: "seed", now: new Date(fakeClock.nowMs),
      });
      let s = seed * 7919;
      const rand = () => {
        s = (Math.imul(s, 1103515245) + 12345) >>> 0;
        return s / 0x1_0000_0000;
      };
      const live = () => listDocs(`businesses/${BUSINESS_ID}/transactions`).map((d) => d.id);
      for (let step = 0; step < 25; step++) {
        const ids = live();
        const id = ids[Math.floor(rand() * ids.length)];
        const r = rand();
        let deleted: string | undefined;
        const run = async () => {
          if (r < 0.15) {
            deleted = id;
            await deleteTx(id);
          } else if (r < 0.35) {
            await createTx(`f${seed}_${step}`, {
              type: ["delivery", "walkin", "direct_sale", "expense"][Math.floor(rand() * 4)],
              customerId: `c${String(Math.floor(rand() * 25)).padStart(3, "0")}`,
              totalAmount: Math.round(rand() * 50000) / 100,
              deliveryStatus: rand() < 0.5 ? "delivered" : "pending",
              balanceDue: 10,
              paymentStatus: "partial",
              amountPaid: rand() < 0.5 ? 5 : 0,
            });
          } else if (r < 0.55) {
            await writeTx(id, {
              payments: [
                { amount: Math.round(rand() * 30000) / 100, date: new Date(fakeClock.nowMs - Math.floor(rand() * 90) * 86_400_000), method: rand() < 0.5 ? "cash" : "digital_wallet", voided: rand() < 0.2 },
              ],
            });
          } else if (r < 0.7) {
            await writeTx(id, { deliveryStatus: ["delivered", "pending", "cancelled", "completed"][Math.floor(rand() * 4)] });
          } else if (r < 0.8) {
            const daysAgo = Math.floor(rand() * 400);
            await writeTx(id, { scheduledAt: new Date(fakeClock.nowMs - daysAgo * 86_400_000) });
          } else if (r < 0.9) {
            await writeCustomer(`c${String(Math.floor(rand() * 25)).padStart(3, "0")}`, {
              status: rand() < 0.3 ? "inactive" : "active",
              healthScore: rand() < 0.5 ? Math.round(rand() * 100) : FakeDelete,
            });
          } else {
            await writeTx(id, { totalAmount: Math.round(rand() * 90000) / 100, paymentStatus: "unpaid" });
          }
        };
        const { result } = await mutateAndRebuild(run, {});
        void deleted;
        expect(["incremental", "full"]).toContain(result?.path);
        await expectMatchesFullRecount(new Date(fakeClock.nowMs));
      }
    });
  }
});

describe("coalescing", () => {
  beforeEach(async () => {
    resetFakeFirestore();
    fakeClock.nowMs = Date.UTC(2026, 10, 9, 4, 0, 0);
    await seedStation({ customers: 12, transactions: 80, seed: 7 });
    await AnalyticsMaterializerService.materialize(BUSINESS_ID, {
      mode: "full", reason: "seed", now: new Date(fakeClock.nowMs),
    });
    fakeClock.nowMs += MATERIALIZE_COALESCE_WINDOW_MS + MIN;
  });

  it("a 20-stop bulk update runs one inline rebuild plus one trailing rebuild", async () => {
    const spy = vi.spyOn(AnalyticsMaterializerService, "materialize");
    let inline = 0;
    for (let i = 0; i < 20; i++) {
      fakeClock.nowMs += 2_000;
      await writeTx(`t00${String(i).padStart(2, "0")}`, { deliveryStatus: "delivered" });
      const leaseId = await AnalyticsMaterializerService.enqueueMaterialize(BUSINESS_ID, {
        nowMs: fakeClock.nowMs,
      });
      if (leaseId) {
        inline += 1;
        await AnalyticsMaterializerService.runLeasedMaterialize(BUSINESS_ID, leaseId, "mutate", fakeClock.nowMs);
      }
    }
    expect(inline).toBe(1);
    expect(rawDoc(queuePath)?.pending).toBe(true);

    // Scheduler tick inside the window defers.
    fakeClock.nowMs += MIN;
    expect((await runProcessAnalyticsMaterializeQueue(fakeClock.nowMs)).rebuilt).toBe(0);

    // After the window: exactly one trailing rebuild clears pending.
    fakeClock.nowMs += MATERIALIZE_COALESCE_WINDOW_MS;
    expect((await runProcessAnalyticsMaterializeQueue(fakeClock.nowMs)).rebuilt).toBe(1);
    expect(rawDoc(queuePath)?.pending).toBe(false);
    expect((await runProcessAnalyticsMaterializeQueue(fakeClock.nowMs + 10 * MIN)).scanned).toBe(0);
    expect(spy).toHaveBeenCalledTimes(2);
    await expectMatchesFullRecount(new Date(fakeClock.nowMs));
    spy.mockRestore();
  });

  it("a live lease blocks a second runner across instances", async () => {
    await writeTx("t0001", { totalAmount: 3 });
    const lease = await AnalyticsMaterializerService.enqueueMaterialize(BUSINESS_ID, {
      nowMs: fakeClock.nowMs,
    });
    expect(lease).toBeTruthy();
    // Another instance (scheduler) sees the lease and backs off even after the window.
    expect(await AnalyticsMaterializerService.tryAcquireMaterializeLease(
      BUSINESS_ID, fakeClock.nowMs + MATERIALIZE_COALESCE_WINDOW_MS + MIN,
    )).toBeNull();
    await AnalyticsMaterializerService.runLeasedMaterialize(BUSINESS_ID, lease as string, "mutate", fakeClock.nowMs);
    expect(rawDoc(queuePath)?.leaseId).toBeUndefined();
  });

  it("mutations during a run keep pending and delete ids survive until processed", async () => {
    await deleteTx("t0002");
    const lease = await AnalyticsMaterializerService.enqueueMaterialize(BUSINESS_ID, {
      nowMs: fakeClock.nowMs, deletedTransactionId: "t0002",
    });
    // A mutation lands after the run read its queue snapshot.
    const original = AnalyticsMaterializerService.materialize.bind(AnalyticsMaterializerService);
    const spy = vi.spyOn(AnalyticsMaterializerService, "materialize").mockImplementationOnce(async (...args) => {
      const out = await original(...args);
      await deleteTx("t0003");
      await AnalyticsMaterializerService.enqueueMaterialize(BUSINESS_ID, {
        nowMs: fakeClock.nowMs + 1000, deletedTransactionId: "t0003",
      });
      return out;
    });
    const result = await AnalyticsMaterializerService.runLeasedMaterialize(BUSINESS_ID, lease as string, "mutate", fakeClock.nowMs);
    expect(result?.path).toBe("incremental");
    expect(rawDoc(queuePath)?.pending).toBe(true);
    expect(rawDoc(queuePath)?.deletedTxIds).toEqual(["t0003"]);
    spy.mockRestore();

    fakeClock.nowMs += MATERIALIZE_COALESCE_WINDOW_MS + MIN;
    expect((await runProcessAnalyticsMaterializeQueue(fakeClock.nowMs)).rebuilt).toBe(1);
    expect(rawDoc(queuePath)?.deletedTxIds).toEqual([]);
    expect(rawDoc(`businesses/${BUSINESS_ID}/analytics_state/meta`)?.txCount).toBe(78);
    await expectMatchesFullRecount(new Date(fakeClock.nowMs));
  });
});
