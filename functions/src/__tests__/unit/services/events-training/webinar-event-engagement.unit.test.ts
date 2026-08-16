import { describe, expect, it } from "vitest";
import {
  normalizeWebinarEventId,
  resolveGuestLikeId,
} from "../../../../services/events-training/webinar-event-engagement-service";

describe("webinar-event-engagement helpers", () => {
  it("normalizeWebinarEventId trims ids", () => {
    expect(normalizeWebinarEventId("  abc123  ")).toBe("abc123");
    expect(normalizeWebinarEventId("")).toBe("");
  });

  it("resolveGuestLikeId prefixes stable guest ids", () => {
    expect(resolveGuestLikeId("guestLocalId01")).toBe("guest:guestLocalId01");
    expect(resolveGuestLikeId("ab")).toMatch(/^guest:[a-f0-9]{24}$/);
  });

  it("resolveGuestLikeId strips unsafe characters", () => {
    expect(resolveGuestLikeId("abc-def_12!!xx")).toBe("guest:abc-def_12xx");
  });
});
