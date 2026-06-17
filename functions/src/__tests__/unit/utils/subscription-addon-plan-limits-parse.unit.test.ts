import { describe, expect, it } from "vitest";
import { parsePlanLimitations } from "../../../utils/subscription-addon-plan-limits";

describe("parsePlanLimitations online_orders", () => {
  it("treats full as unlimited", () => {
    const q = parsePlanLimitations({ online_orders: "full" });
    expect(q?.onlineOrders).toBeNull();
  });

  it("parses daily capped online orders", () => {
    const q = parsePlanLimitations({
      online_orders: { frequency: "daily", max: 10 },
    });
    expect(q?.onlineOrders).toEqual({ frequency: "daily", max: 10 });
  });

  it("parses monthly capped online orders", () => {
    const q = parsePlanLimitations({
      onlineOrders: { frequency: "monthly", max: 200 },
    });
    expect(q?.onlineOrders).toEqual({ frequency: "monthly", max: 200 });
  });

  it("defaults frequency to daily when omitted", () => {
    const q = parsePlanLimitations({ online_orders: { max: 5 } });
    expect(q?.onlineOrders).toEqual({ frequency: "daily", max: 5 });
  });
});
