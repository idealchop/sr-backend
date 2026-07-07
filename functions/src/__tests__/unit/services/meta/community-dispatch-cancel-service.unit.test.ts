import { describe, expect, it } from "vitest";
import { parseCommunityCancelRequest } from "../../../../services/meta/community-dispatch-cancel-service";
import {
  buildCommunityCancelReasonRequiredMessage,
  buildCommunityNearbyStationsAckMessage,
  buildCommunitySearchRadiusExpandMessage,
  COMMUNITY_CANCEL_WHILE_WAITING_HINT,
} from "../../../../services/meta/community-messenger-customer-notifier";

describe("community cancel with reason", () => {
  it("parses CANCEL - reason case-insensitively", () => {
    expect(parseCommunityCancelRequest("CANCEL - found a nearer station")).toEqual({
      kind: "with_reason",
      reason: "found a nearer station",
    });
    expect(parseCommunityCancelRequest("cancel - Wrong address")).toEqual({
      kind: "with_reason",
      reason: "Wrong address",
    });
  });

  it("treats bare cancel as missing reason", () => {
    expect(parseCommunityCancelRequest("cancel")).toEqual({ kind: "bare_cancel" });
    expect(parseCommunityCancelRequest("CANCEL")).toEqual({ kind: "bare_cancel" });
  });

  it("treats cancel with empty reason as bare cancel", () => {
    expect(parseCommunityCancelRequest("CANCEL -")).toEqual({ kind: "bare_cancel" });
    expect(parseCommunityCancelRequest("CANCEL -   ")).toEqual({ kind: "bare_cancel" });
  });

  it("ignores unrelated messages", () => {
    expect(parseCommunityCancelRequest("hello")).toEqual({ kind: "none" });
    expect(parseCommunityCancelRequest("cancelled order")).toEqual({ kind: "none" });
  });

  it("builds cancel reason required template with example", () => {
    const msg = buildCommunityCancelReasonRequiredMessage("CR-ABC12345");
    expect(msg).toContain("CR-ABC12345");
    expect(msg).toContain("CANCEL - {reason}");
    expect(msg).toContain("Halimbawa: CANCEL - may mas malapit na station");
    expect(msg).toContain("Hintayin lang po");
  });

  it("uses patient-wait cancel hint on initial ack", () => {
    const msg = buildCommunityNearbyStationsAckMessage({
      referenceId: "CR-ABC12345",
      nearbyCount: 2,
      searchRadiusKm: 5,
    });

    expect(msg).toContain(COMMUNITY_CANCEL_WHILE_WAITING_HINT);
    expect(msg).toContain("Sandali lang po");
    expect(msg).toContain("CANCEL - {reason}");
    expect(msg).not.toContain("reply CANCEL to cancel");
  });

  it("uses patient-wait cancel hint on radius expand", () => {
    const msg = buildCommunitySearchRadiusExpandMessage({
      referenceId: "CR-ABC12345",
      fromRadiusKm: 5,
      toRadiusKm: 10,
      reason: "no_accept",
      nearbyCount: 1,
    });

    expect(msg).toContain("Sandali lang po");
    expect(msg).toContain("CANCEL - {reason}");
  });
});
