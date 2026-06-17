import { describe, expect, it } from "vitest";
import {
  deliveryStatusLabel,
  transactionTypeLabel,
} from "../../../../services/notifications/station-activity-notification-service";

describe("station-activity-notification formatters", () => {
  it("labels transaction types for owners", () => {
    expect(transactionTypeLabel("walkin")).toBe("Walk-in sale");
    expect(transactionTypeLabel("expense")).toBe("Expense");
    expect(transactionTypeLabel("collection")).toBe("Collection");
    expect(transactionTypeLabel("delivery")).toBe("Delivery order");
  });

  it("labels delivery statuses in plain language", () => {
    expect(deliveryStatusLabel("in-transit")).toBe("in transit");
    expect(deliveryStatusLabel("completed")).toBe("completed");
  });
});
