import { describe, expect, it } from "vitest";
import {
  buildRiderMessengerReasonListMessage,
  parseReasonCommand,
  resolveRiderMessengerStatusReason,
} from "../../../../services/rider/rider-messenger-status-reasons-service";

describe("parseReasonCommand", () => {
  it("parses REASON index", () => {
    expect(parseReasonCommand("REASON 1")).toEqual({ index: 1 });
    expect(parseReasonCommand("reason 2")).toEqual({ index: 2 });
  });

  it("parses REASON with detail suffix", () => {
    expect(parseReasonCommand("REASON 4 - stuck sa traffic")).toEqual({
      index: 4,
      detail: "stuck sa traffic",
    });
  });
});

describe("resolveRiderMessengerStatusReason", () => {
  it("returns fail and cancel lists", () => {
    expect(resolveRiderMessengerStatusReason("failed", 1)?.id).toBe(
      "customer_unavailable",
    );
    expect(resolveRiderMessengerStatusReason("cancelled", 1)?.id).toBe(
      "customer_requested",
    );
  });
});

describe("buildRiderMessengerReasonListMessage", () => {
  it("includes numbered reasons", () => {
    const msg = buildRiderMessengerReasonListMessage({
      targetStatus: "failed",
      referenceId: "TX-1001",
    });
    expect(msg).toContain("Failed · TX-1001");
    expect(msg).toContain("1. Customer unavailable");
    expect(msg).toContain("REASON #");
  });
});
