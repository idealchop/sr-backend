import { describe, expect, it } from "vitest";
import {
  catalogStatusOf,
  isCatalogLiveForNewSales,
  nextManilaMidnight,
} from "../../../utils/catalog-publication";

describe("catalog-publication", () => {
  it("treats missing catalogStatus as published", () => {
    expect(catalogStatusOf(null)).toBe("published");
    expect(catalogStatusOf({ catalogStatus: "DRAFT" })).toBe("draft");
  });

  it("requires published + active + effective for new sales", () => {
    const now = new Date("2026-09-19T04:00:00Z");
    expect(isCatalogLiveForNewSales(undefined, now)).toBe(false);
    expect(isCatalogLiveForNewSales({ catalogStatus: "published", isActive: true }, now)).toBe(
      true,
    );
  });

  it("computes the next Asia/Manila midnight", () => {
    const from = new Date("2026-09-19T10:30:00+08:00");
    expect(nextManilaMidnight(from).toISOString()).toBe("2026-09-19T16:00:00.000Z");
  });
});
