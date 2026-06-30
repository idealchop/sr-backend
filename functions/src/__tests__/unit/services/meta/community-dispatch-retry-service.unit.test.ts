import { describe, expect, it } from "vitest";
import {
  buildRetryFieldsFromFollowUp,
  looksLikeAddressFollowUp,
  mergeCommunityOrderFields,
} from "../../../../services/meta/community-dispatch-retry-service";
import type { CommunityDispatchRequestDoc } from "../../../../services/meta/community-dispatch-request-types";

describe("community-dispatch-retry-service", () => {
  const pendingLocation = {
    id: "req-1",
    doc: {
      status: "needs_location",
      sourceChannel: "community_messenger",
      metaPsid: "psid-1",
      metaMessageId: "mid-1",
      referenceId: "CR-TEST",
      rawMessage: "original",
      parsed: {
        name: "Justfer",
        delivery: true,
        qty: 5,
        number: "09773907598",
        preferredWaterType: "alkaline",
        location: "muntinlupa",
      },
      parseSource: "template",
    } as CommunityDispatchRequestDoc,
  };

  it("detects plain address follow-ups", () => {
    expect(looksLikeAddressFollowUp("blk 08 lot 09 Cagiao St, Muntinlupa")).toBe(true);
    expect(looksLikeAddressFollowUp("yes")).toBe(false);
    expect(looksLikeAddressFollowUp("hi")).toBe(false);
  });

  it("merges a clearer address for needs_location", () => {
    const fields = buildRetryFieldsFromFollowUp({
      pending: pendingLocation,
      text: "blk 08 lot 09 Cagiao St. Katarungan Village, Muntinlupa City",
      templateFields: {},
      templateLooksComplete: false,
    });

    expect(fields?.location).toContain("Cagiao");
    expect(fields?.name).toBe("Justfer");
    expect(fields?.preferredWaterType).toBe("alkaline");
  });

  it("merges a full template resubmit over pending request", () => {
    const fields = buildRetryFieldsFromFollowUp({
      pending: pendingLocation,
      text: "ignored",
      templateFields: {
        name: "Justfer",
        delivery: true,
        qty: 5,
        number: "09773907598",
        preferredWaterType: "mineral",
        location: "123 Main Street, Muntinlupa",
      },
      templateLooksComplete: true,
    });

    expect(fields?.preferredWaterType).toBe("mineral");
    expect(fields?.location).toBe("123 Main Street, Muntinlupa");
  });

  it("mergeCommunityOrderFields keeps base when patch is empty", () => {
    const merged = mergeCommunityOrderFields(
      { name: "Ana", qty: 2, number: "09171234567" },
      {},
    );
    expect(merged.name).toBe("Ana");
    expect(merged.qty).toBe(2);
  });
});
