import { describe, expect, it } from "vitest";
import { isLegacyUnpaidStarterRow, planAllowsDuplicateAiValidation, planAllowsForecast, planAllowsForecastAi } from "../../../utils/subscription-plan-codes";

describe("isLegacyUnpaidStarterRow", () => {
  it("matches unpaid starter by planCode or planName", () => {
    expect(isLegacyUnpaidStarterRow({ planCode: "starter", price: 0 })).toBe(true);
    expect(isLegacyUnpaidStarterRow({ planName: "Starter", price: 0 })).toBe(true);
    expect(isLegacyUnpaidStarterRow({ planCode: "starter", price: 399 })).toBe(
      false,
    );
    expect(isLegacyUnpaidStarterRow({ planCode: "free", price: 0 })).toBe(false);
    expect(isLegacyUnpaidStarterRow({ planCode: "scale", price: 0 })).toBe(false);
  });
});

describe("planAllowsDuplicateAiValidation", () => {
  it("is off for Free through Grow and on for Scale family", () => {
    expect(planAllowsDuplicateAiValidation("free")).toBe(false);
    expect(planAllowsDuplicateAiValidation("starter")).toBe(false);
    expect(planAllowsDuplicateAiValidation("grow")).toBe(false);
    expect(planAllowsDuplicateAiValidation("pro")).toBe(false);
    expect(planAllowsDuplicateAiValidation("scale")).toBe(true);
    expect(planAllowsDuplicateAiValidation("enterprise")).toBe(true);
  });
});

describe("planAllowsForecast", () => {
  it("is on for Grow family and Scale family", () => {
    expect(planAllowsForecast("free")).toBe(false);
    expect(planAllowsForecast("starter")).toBe(false);
    expect(planAllowsForecast("grow")).toBe(true);
    expect(planAllowsForecast("pro")).toBe(true);
    expect(planAllowsForecast("scale")).toBe(true);
    expect(planAllowsForecast("enterprise")).toBe(true);
  });
});

describe("planAllowsForecastAi", () => {
  it("is off for Free through Grow and on for Scale family", () => {
    expect(planAllowsForecastAi("free")).toBe(false);
    expect(planAllowsForecastAi("starter")).toBe(false);
    expect(planAllowsForecastAi("grow")).toBe(false);
    expect(planAllowsForecastAi("pro")).toBe(false);
    expect(planAllowsForecastAi("scale")).toBe(true);
    expect(planAllowsForecastAi("enterprise")).toBe(true);
  });
});
