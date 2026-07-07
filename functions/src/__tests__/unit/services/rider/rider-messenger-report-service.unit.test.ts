import { describe, expect, it } from "vitest";
import {
  applyReportBreakdownToCollectionItem,
  findNextUnreportedCollectionIndex,
  parseQuantityFromFragment,
  parseReportBreakdownReply,
  resolveReportTargetIndex,
} from "../../../../services/rider/rider-messenger-report-service";
import type { CollectionItem } from "../../../../services/transactions/transaction-service";

const baseItem: CollectionItem = {
  inventoryId: "inv1",
  name: "Slim gallon",
  qtyExpected: 5,
  qtyCollected: 0,
  qtyOk: 0,
  qtyDamaged: 0,
  qtyMissing: 0,
  deficitQty: 0,
  status: "pending",
};

describe("parseQuantityFromFragment", () => {
  it("parses digits and Filipino words", () => {
    expect(parseQuantityFromFragment("5")).toBe(5);
    expect(parseQuantityFromFragment("lima")).toBe(5);
    expect(parseQuantityFromFragment("5 o lima")).toBe(5);
    expect(parseQuantityFromFragment("isang")).toBe(1);
  });
});

describe("parseReportBreakdownReply", () => {
  it("parses plain number and Filipino lone word as all good", () => {
    expect(parseReportBreakdownReply("5")).toEqual({ mode: "simple", qtyOk: 5 });
    expect(parseReportBreakdownReply("lima")).toEqual({ mode: "simple", qtyOk: 5 });
  });

  it("parses shorthand O G M D labels", () => {
    expect(parseReportBreakdownReply("O:5")).toEqual({
      mode: "breakdown",
      qtyOk: 5,
      qtyMissing: 0,
      qtyDamaged: 0,
    });
    expect(parseReportBreakdownReply("G:4 M:1 D:0")).toEqual({
      mode: "breakdown",
      qtyOk: 4,
      qtyMissing: 1,
      qtyDamaged: 0,
    });
    expect(parseReportBreakdownReply("OK: 3 M: 2 D: 0")).toEqual({
      mode: "breakdown",
      qtyOk: 3,
      qtyMissing: 2,
      qtyDamaged: 0,
    });
  });

  it("parses GOOD MISSING DAMAGE breakdown", () => {
    expect(parseReportBreakdownReply("GOOD: 4 MISSING: 1 DAMAGE: 0")).toEqual({
      mode: "breakdown",
      qtyOk: 4,
      qtyMissing: 1,
      qtyDamaged: 0,
    });
  });

  it("parses Taglish kulang and sira with expected context", () => {
    expect(parseReportBreakdownReply("kulang ng 5", { qtyExpected: 10 })).toEqual({
      mode: "breakdown",
      qtyOk: 5,
      qtyMissing: 5,
      qtyDamaged: 0,
    });
    expect(parseReportBreakdownReply("kulang ng lima", { qtyExpected: 10 })).toEqual({
      mode: "breakdown",
      qtyOk: 5,
      qtyMissing: 5,
      qtyDamaged: 0,
    });
    expect(parseReportBreakdownReply("may 1 sira", { qtyExpected: 5 })).toEqual({
      mode: "breakdown",
      qtyOk: 4,
      qtyMissing: 0,
      qtyDamaged: 1,
    });
  });

  it("parses missing lid phrasing as missing 1", () => {
    expect(
      parseReportBreakdownReply("kulang ng isang takip yung container", {
        qtyExpected: 5,
      }),
    ).toEqual({
      mode: "breakdown",
      qtyOk: 4,
      qtyMissing: 1,
      qtyDamaged: 0,
    });
  });
});

const roundItem: CollectionItem = {
  ...baseItem,
  name: "Round gallon",
};

const slimItem: CollectionItem = {
  ...baseItem,
  inventoryId: "inv2",
  name: "Slim gallon",
  qtyExpected: 3,
};

describe("resolveReportTargetIndex", () => {
  it("defaults free text to sole container", () => {
    expect(resolveReportTargetIndex("kulang ng lima", [roundItem])).toEqual({
      index: 0,
    });
    expect(resolveReportTargetIndex("may 1 sira", [roundItem])).toEqual({
      index: 0,
    });
  });

  it("defaults when order is round-only", () => {
    const roundOnly = [
      { ...roundItem, qtyExpected: 5 },
      { ...roundItem, inventoryId: "inv2", name: "Round jug", qtyExpected: 2 },
    ];
    expect(resolveReportTargetIndex("kulang ng lima", roundOnly)).toEqual({
      index: 0,
    });
  });

  it("requires container name when mixed types", () => {
    const result = resolveReportTargetIndex("kulang ng lima", [roundItem, slimItem]);
    expect(result).toEqual({
      error: "need_container",
      options: ["Round gallon", "Slim gallon"],
    });
  });

  it("matches container hint in free text", () => {
    expect(
      resolveReportTargetIndex("round kulang ng lima", [roundItem, slimItem]),
    ).toEqual({ index: 0 });
    expect(
      resolveReportTargetIndex("slim may 1 sira", [roundItem, slimItem]),
    ).toEqual({ index: 1 });
  });

  it("uses wizard index for plain numbers on multi-container", () => {
    expect(resolveReportTargetIndex("5", [roundItem, slimItem], 1)).toEqual({
      index: 1,
    });
  });
});

describe("findNextUnreportedCollectionIndex", () => {
  it("skips reported items", () => {
    const items = [
      { ...roundItem, status: "ok" as const, qtyOk: 5 },
      { ...slimItem, status: "pending" as const },
    ];
    expect(findNextUnreportedCollectionIndex(items)).toBe(1);
  });
});

describe("applyReportBreakdownToCollectionItem", () => {
  it("treats plain number with auto-missing when below expected", () => {
    const updated = applyReportBreakdownToCollectionItem(baseItem, {
      mode: "simple",
      qtyOk: 4,
    });
    expect(updated.qtyOk).toBe(4);
    expect(updated.qtyMissing).toBe(1);
    expect(updated.qtyDamaged).toBe(0);
    expect(updated.status).toBe("missing");
  });

  it("applies explicit breakdown", () => {
    const updated = applyReportBreakdownToCollectionItem(baseItem, {
      mode: "breakdown",
      qtyOk: 4,
      qtyMissing: 1,
      qtyDamaged: 0,
    });
    expect(updated.qtyOk).toBe(4);
    expect(updated.qtyMissing).toBe(1);
    expect(updated.status).toBe("missing");
  });

  it("marks damaged status when damage > 0", () => {
    const updated = applyReportBreakdownToCollectionItem(baseItem, {
      mode: "breakdown",
      qtyOk: 3,
      qtyMissing: 1,
      qtyDamaged: 1,
    });
    expect(updated.qtyDamaged).toBe(1);
    expect(updated.status).toBe("damaged");
  });
});
