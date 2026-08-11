import { describe, expect, it } from "vitest";
import {
  AI_UNDER_MAINTENANCE_MESSAGE,
  assertAiFeatureAvailable,
  AiUnderMaintenanceError,
  isAiOperationAllowedDuringMaintenance,
  SMARTREFILL_AI_UNDER_MAINTENANCE,
} from "../../../../services/ai/ai-maintenance";

describe("ai-maintenance", () => {
  it("allows import operations during maintenance", () => {
    expect(isAiOperationAllowedDuringMaintenance("customer.import.text")).toBe(
      true,
    );
    expect(
      isAiOperationAllowedDuringMaintenance("customer_history.import.image"),
    ).toBe(true);
    expect(isAiOperationAllowedDuringMaintenance("inventory.import.text")).toBe(
      true,
    );
  });

  it("allows River AI Buddy while tools stay in maintenance", () => {
    expect(isAiOperationAllowedDuringMaintenance("support.buddy")).toBe(true);
    expect(isAiOperationAllowedDuringMaintenance("river_ai_agent.intent")).toBe(
      true,
    );
  });

  it("blocks non-import Gemini operations while maintenance is on", () => {
    if (!SMARTREFILL_AI_UNDER_MAINTENANCE) return;
    expect(isAiOperationAllowedDuringMaintenance("duplicates.validate")).toBe(
      false,
    );
    expect(isAiOperationAllowedDuringMaintenance("ai_tool_run:morning_brief")).toBe(
      false,
    );
    expect(() => assertAiFeatureAvailable("order.parse")).toThrow(
      AiUnderMaintenanceError,
    );
    expect(() => assertAiFeatureAvailable("order.parse")).toThrow(
      AI_UNDER_MAINTENANCE_MESSAGE,
    );
  });
});
