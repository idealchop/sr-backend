import { describe, expect, it } from "vitest";
import {
  buildDormantDigestCopy,
  shouldSendDormantDigestNow,
} from "../../../../services/notifications/dormant-digest-service";

describe("dormant-digest-service", () => {
  const now = new Date("2026-06-02T23:00:00.000Z"); // 7:00 Manila (UTC+8)

  it("builds deterministic copy with revenue", () => {
    const copy = buildDormantDigestCopy(3, 1250.5);
    expect(copy.title).toBe("3 dormant sukis");
    expect(copy.body).toContain("₱1,251");
    expect(copy.body).toContain("Forecast");
  });

  it("sends only at configured hour when enabled", () => {
    expect(
      shouldSendDormantDigestNow(
        { dormantPushEnabled: true, dormantPushHour: 7 },
        undefined,
        now,
      ),
    ).toBe(true);

    expect(
      shouldSendDormantDigestNow(
        { dormantPushEnabled: true, dormantPushHour: 8 },
        undefined,
        now,
      ),
    ).toBe(false);

    expect(
      shouldSendDormantDigestNow(
        { dormantPushEnabled: false, dormantPushHour: 7 },
        undefined,
        now,
      ),
    ).toBe(false);
  });

  it("skips when already sent today", () => {
    expect(
      shouldSendDormantDigestNow(
        { dormantPushEnabled: true, dormantPushHour: 7 },
        "2026-06-03",
        now,
      ),
    ).toBe(false);
  });
});
