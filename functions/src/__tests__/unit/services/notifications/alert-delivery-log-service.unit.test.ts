import { describe, expect, it } from "vitest";
import { mapContributorToDeliveryLog } from "../../../../services/notifications/alert-delivery-log-service";

describe("alert-delivery-log-service helpers", () => {
  it("maps email contributors to email channel", () => {
    const input = mapContributorToDeliveryLog("morning_brief_email", true);
    expect(input.channel).toBe("email");
    expect(input.status).toBe("sent");
  });

  it("maps push contributors to push channel", () => {
    const input = mapContributorToDeliveryLog("proactive_push", false);
    expect(input.channel).toBe("push");
    expect(input.status).toBe("skipped");
  });
});
