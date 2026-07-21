import { describe, expect, it } from "vitest";
import {
  customerDeliveryDetail,
  mapContributorToDeliveryLog,
  matchesCustomerDeliveryLog,
} from "../../../../services/notifications/alert-delivery-log-service";

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

  it("matches by customerId in detail", () => {
    expect(
      matchesCustomerDeliveryLog(
        { audience: "customer", detail: { customerId: "c1" } },
        { customerId: "c1" },
      ),
    ).toBe(true);
  });

  it("matches by toEmail", () => {
    expect(
      matchesCustomerDeliveryLog(
        { audience: "customer", detail: { toEmail: "A@X.com" } },
        { customerId: "c1", customerEmail: "a@x.com" },
      ),
    ).toBe(true);
  });

  it("matches by referenceId for legacy rows", () => {
    expect(
      matchesCustomerDeliveryLog(
        { audience: "customer", detail: { referenceId: "ORD-1" } },
        { customerId: "c1", referenceIds: ["ORD-1", "ORD-2"] },
      ),
    ).toBe(true);
  });

  it("rejects owner audience", () => {
    expect(
      matchesCustomerDeliveryLog(
        { audience: "owner", detail: { customerId: "c1" } },
        { customerId: "c1" },
      ),
    ).toBe(false);
  });

  it("builds customer delivery detail", () => {
    expect(
      customerDeliveryDetail(
        { event: "completed", referenceId: "R1" },
        { customerId: "c9", toEmail: " Suki@Mail.com " },
      ),
    ).toEqual({
      event: "completed",
      referenceId: "R1",
      customerId: "c9",
      toEmail: "suki@mail.com",
    });
  });
});
