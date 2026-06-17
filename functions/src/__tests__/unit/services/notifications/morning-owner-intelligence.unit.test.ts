import { describe, expect, it } from "vitest";
import { shouldRunAutoMorningBriefNow } from
  "../../../../services/notifications/morning-brief-scheduler-service";
import { shouldSendDormantEmailDigestNow } from
  "../../../../services/notifications/dormant-digest-email-service";
import { buildDormantDigestEmail } from
  "../../../../utils/dormant-digest-email-template";

describe("morning-brief-scheduler-service", () => {
  const monday7amManila = new Date("2026-05-31T23:00:00.000Z");

  it("runs auto brief once per day at configured hour", () => {
    expect(
      shouldRunAutoMorningBriefNow(
        { autoMorningBriefEnabled: true, dormantPushHour: 7 },
        undefined,
        monday7amManila,
      ),
    ).toBe(true);

    expect(
      shouldRunAutoMorningBriefNow(
        { autoMorningBriefEnabled: true, dormantPushHour: 7 },
        "2026-06-01",
        monday7amManila,
      ),
    ).toBe(false);
  });
});

describe("dormant-digest-email-service", () => {
  const monday7amManila = new Date("2026-05-31T23:00:00.000Z");

  it("sends weekly email on Monday at configured hour only", () => {
    expect(
      shouldSendDormantEmailDigestNow(
        { dormantEmailDigestEnabled: true, dormantPushHour: 7 },
        undefined,
        monday7amManila,
      ),
    ).toBe(true);

    expect(
      shouldSendDormantEmailDigestNow(
        { dormantEmailDigestEnabled: true, dormantPushHour: 7 },
        "2026-06-01",
        monday7amManila,
      ),
    ).toBe(false);
  });

  it("skips on non-Monday", () => {
    const tuesday7amManila = new Date("2026-06-01T23:00:00.000Z");
    expect(
      shouldSendDormantEmailDigestNow(
        { dormantEmailDigestEnabled: true, dormantPushHour: 7 },
        undefined,
        tuesday7amManila,
      ),
    ).toBe(false);
  });
});

describe("dormant-digest-email-template", () => {
  it("builds subject and includes brief snippet when provided", () => {
    const tpl = buildDormantDigestEmail({
      businessName: "Ana Water Station",
      ownerName: "Ana",
      dormantCount: 2,
      revenueAtRiskPhp: 500,
      cadenceLateCount: 1,
      dashboardUrl: "https://smartrefill.io/dashboard",
      morningBriefSummary: "Prioritize Ben and Carla today.",
    });
    expect(tpl.subject).toContain("2 dormant");
    expect(tpl.html).toContain("Prioritize Ben and Carla");
    expect(tpl.text).toContain("Open Forecast");
  });
});
