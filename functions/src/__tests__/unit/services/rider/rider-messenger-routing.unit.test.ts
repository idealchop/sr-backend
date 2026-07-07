import { describe, expect, it, vi, beforeEach } from "vitest";
import { shouldRouteToRiderMessenger } from "../../../../services/rider/rider-messenger-routing";

vi.mock("../../../../services/rider/rider-messenger-link-service", () => ({
  RiderMessengerLinkService: {
    resolveLinkedRider: vi.fn(),
  },
}));

import { RiderMessengerLinkService } from "../../../../services/rider/rider-messenger-link-service";

describe("shouldRouteToRiderMessenger", () => {
  beforeEach(() => {
    vi.mocked(RiderMessengerLinkService.resolveLinkedRider).mockResolvedValue(null);
  });

  it("routes linked PSID to rider flow", async () => {
    vi.mocked(RiderMessengerLinkService.resolveLinkedRider).mockResolvedValue({
      businessId: "biz1",
      riderId: "r1",
      riderName: "Juan",
      stationLabel: "WRS A",
      linkedAt: {} as never,
      psid: "psid-linked",
    });

    const result = await shouldRouteToRiderMessenger({
      sender: { id: "psid-linked" },
      message: { text: "hello" },
    });
    expect(result).toBe(true);
  });

  it("routes LINK command before link", async () => {
    const result = await shouldRouteToRiderMessenger({
      sender: { id: "psid-new" },
      message: { text: "LINK RDR-7K2M" },
    });
    expect(result).toBe(true);
  });

  it("routes JOBS from unlinked PSID (will prompt for link)", async () => {
    const result = await shouldRouteToRiderMessenger({
      sender: { id: "psid-new" },
      message: { text: "JOBS" },
    });
    expect(result).toBe(true);
  });

  it("routes NEARBY from unlinked PSID", async () => {
    const result = await shouldRouteToRiderMessenger({
      sender: { id: "psid-new" },
      message: { text: "NEARBY" },
    });
    expect(result).toBe(true);
  });

  it("routes GROUP # from unlinked PSID", async () => {
    const result = await shouldRouteToRiderMessenger({
      sender: { id: "psid-new" },
      message: { text: "GROUP 1" },
    });
    expect(result).toBe(true);
  });

  it("routes DETAILS and ORDER from unlinked PSID", async () => {
    expect(
      await shouldRouteToRiderMessenger({
        sender: { id: "psid-new" },
        message: { text: "DETAILS 2" },
      }),
    ).toBe(true);
    expect(
      await shouldRouteToRiderMessenger({
        sender: { id: "psid-new" },
        message: { text: "ORDER 2 DELIVERY 5" },
      }),
    ).toBe(true);
  });

  it("does not route normal customer order text", async () => {
    const result = await shouldRouteToRiderMessenger({
      sender: { id: "psid-customer" },
      message: { text: "5 gal kay Maria Brgy San Roque" },
    });
    expect(result).toBe(false);
  });

  it("routes RD_ postbacks", async () => {
    const result = await shouldRouteToRiderMessenger({
      sender: { id: "psid-new" },
      postback: { payload: "RD_JOBS" },
    });
    expect(result).toBe(true);
  });
});
