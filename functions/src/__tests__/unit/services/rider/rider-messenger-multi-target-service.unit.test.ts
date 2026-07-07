import { describe, expect, it } from "vitest";
import {
  formatMultiTargetLabel,
  parseMultiJobTargets,
  resolveJobTargets,
} from "../../../../services/rider/rider-messenger-multi-target-service";
import type { RiderMessengerJobRow } from "../../../../services/rider/rider-messenger-types";

describe("parseMultiJobTargets", () => {
  it("parses comma-separated indices", () => {
    expect(parseMultiJobTargets("1,2,3")).toEqual(["1", "2", "3"]);
    expect(parseMultiJobTargets("1, 2, 3")).toEqual(["1", "2", "3"]);
  });

  it("parses numeric ranges", () => {
    expect(parseMultiJobTargets("1 to 5")).toEqual(["1", "2", "3", "4", "5"]);
    expect(parseMultiJobTargets("1-5")).toEqual(["1", "2", "3", "4", "5"]);
    expect(parseMultiJobTargets("1 - 5")).toEqual(["1", "2", "3", "4", "5"]);
  });

  it("parses mixed comma and range segments", () => {
    expect(parseMultiJobTargets("1,3 to 5")).toEqual(["1", "3", "4", "5"]);
  });

  it("returns null for single targets", () => {
    expect(parseMultiJobTargets("1")).toBeNull();
    expect(parseMultiJobTargets("TX-1042")).toBeNull();
  });

  it("dedupes repeated tokens", () => {
    expect(parseMultiJobTargets("1,2,1,3")).toEqual(["1", "2", "3"]);
  });
});

describe("formatMultiTargetLabel", () => {
  it("formats consecutive ranges compactly", () => {
    expect(formatMultiTargetLabel(["1", "2", "3", "4", "5"])).toBe("#1–#5");
  });

  it("formats non-consecutive lists", () => {
    expect(formatMultiTargetLabel(["1", "3", "5"])).toBe("#1, #3, #5");
  });
});

describe("resolveJobTargets", () => {
  const jobs: RiderMessengerJobRow[] = [
    {
      index: 1,
      transactionId: "tx1",
      referenceId: "TX-1",
      customerName: "Ana",
      type: "delivery",
      status: "in-transit",
      itemsSummary: "1 refill",
      isTodo: true,
      isDoneToday: false,
    },
    {
      index: 2,
      transactionId: "tx2",
      referenceId: "TX-2",
      customerName: "Ben",
      type: "delivery",
      status: "in-transit",
      itemsSummary: "2 refill",
      isTodo: true,
      isDoneToday: false,
    },
  ];

  it("resolves multiple jobs and reports missing tokens", () => {
    const result = resolveJobTargets(jobs, ["1", "2", "9"]);
    expect(result.resolved.map((job) => job.index)).toEqual([1, 2]);
    expect(result.missing).toEqual(["9"]);
  });
});
