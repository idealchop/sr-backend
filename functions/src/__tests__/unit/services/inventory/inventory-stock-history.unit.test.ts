import { describe, expect, it } from "vitest";
import { serializeFirestoreTimestamp } from
  "../../../../services/inventory/inventory-stock-history";

describe("inventory-stock-history", () => {
  it("serializes Firestore-like timestamps", () => {
    expect(serializeFirestoreTimestamp("2026-05-28T12:00:00.000Z")).toBe(
      "2026-05-28T12:00:00.000Z",
    );
    expect(
      serializeFirestoreTimestamp({
        seconds: 1716897600,
        nanoseconds: 0,
      }),
    ).toBeTruthy();
  });
});
