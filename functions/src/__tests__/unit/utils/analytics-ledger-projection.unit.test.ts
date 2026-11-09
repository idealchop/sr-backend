import { describe, expect, it } from "vitest";
import { Timestamp } from "firebase-admin/firestore";
import {
  applyProjectionChanges,
  compareFirestoreValues,
  decodeProjectedRecord,
  decodeValue,
  encodeValue,
  orderProjectedDesc,
  projectTransactionRecord,
  projectCustomerRecord,
  recordsFromShards,
  shardIndexForId,
  shardRecords,
} from "../../../utils/analytics-ledger-projection";

describe("analytics ledger projection encoding", () => {
  it("round-trips Timestamps to the same instant as Timestamp.toDate()", () => {
    const t = new Timestamp(1_762_660_000, 987_654_321);
    const decoded = decodeValue(encodeValue(t) as never) as Date;
    expect(decoded).toBeInstanceOf(Date);
    expect(decoded.getTime()).toBe(t.toDate().getTime());
  });

  it("keeps strings, nulls, plain {seconds} maps and special numbers as-is", () => {
    expect(decodeValue(encodeValue("2026-01-02T00:00:00Z") as never)).toBe("2026-01-02T00:00:00Z");
    expect(decodeValue(encodeValue(null) as never)).toBeNull();
    const plain = { seconds: 5, nanoseconds: 0 };
    expect(decodeValue(encodeValue(plain) as never)).toEqual(plain);
    expect(Number.isNaN(decodeValue(encodeValue(NaN) as never) as number)).toBe(true);
    expect(encodeValue(undefined)).toBeUndefined();
  });

  it("keeps only KPI fields, preserves a stored id override, drops unused fields", () => {
    const rec = projectTransactionRecord("doc1", {
      type: "delivery",
      totalAmount: 100,
      notes: "drop me",
      address: { line1: "x" },
      payments: [{ amount: 50, date: Timestamp.fromMillis(1000), method: "cash", ref: "drop" }],
      waterRefills: [{ quantity: 3, productId: "drop" }],
    });
    expect(Object.keys(rec.data).sort()).toEqual(["payments", "totalAmount", "type", "waterRefills"]);
    const row = decodeProjectedRecord<Record<string, unknown>>(rec);
    expect(row.id).toBe("doc1");
    expect(row.payments).toEqual([{ amount: 50, date: new Date(1000), method: "cash" }]);

    const withId = decodeProjectedRecord<Record<string, unknown>>(
      projectCustomerRecord("doc2", { id: "stored", name: "A" }),
    );
    expect(withId.id).toBe("stored");
  });
});

describe("Firestore ordering mirror", () => {
  const rec = (docId: string, scheduledAt?: unknown) =>
    projectTransactionRecord(docId, scheduledAt === undefined ? {} : { scheduledAt });

  it("orders desc by type rank then value, ties by doc id desc, excludes missing", () => {
    const ordered = orderProjectedDesc([
      rec("a", Timestamp.fromMillis(2000)),
      rec("b", Timestamp.fromMillis(3000)),
      rec("c", "2020-01-01"),
      rec("d", null),
      rec("e"),
      rec("f", Timestamp.fromMillis(2000)),
      rec("g", 5),
    ], "scheduledAt");
    expect(ordered.map((r) => r.docId)).toEqual(["c", "b", "f", "a", "g", "d"]);
  });

  it("compares timestamps by seconds then nanos", () => {
    const a = encodeValue(new Timestamp(10, 5)) as never;
    const b = encodeValue(new Timestamp(10, 6)) as never;
    expect(compareFirestoreValues(a, b)).toBe(-1);
    expect(compareFirestoreValues(b, a)).toBe(1);
  });

  it("applies limit after ordering", () => {
    const out = orderProjectedDesc(
      [1, 2, 3, 4].map((n) => rec(`t${n}`, Timestamp.fromMillis(n * 1000))),
      "scheduledAt",
      2,
    );
    expect(out.map((r) => r.docId)).toEqual(["t4", "t3"]);
  });
});

describe("projection shards", () => {
  it("round-trips through shards and reports only dirty shards", () => {
    const records = new Map(
      Array.from({ length: 50 }, (_, i) => {
        const r = projectTransactionRecord(`t${i}`, { totalAmount: i });
        return [r.docId, r] as const;
      }),
    );
    const shards = shardRecords(records.values(), 16);
    expect(recordsFromShards(shards)).toEqual(records);

    const dirty = applyProjectionChanges(
      records,
      [projectTransactionRecord("t1", { totalAmount: 1 }), projectTransactionRecord("t2", { totalAmount: 99 })],
      ["t3", "missing"],
      16,
    );
    expect(dirty).toEqual(new Set([shardIndexForId("t2", 16), shardIndexForId("t3", 16)]));
    expect(records.has("t3")).toBe(false);
  });
});
