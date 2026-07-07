import { describe, expect, it } from "vitest";
import {
  buildCustomerContainerCustodyAcceptance,
  businessHasActiveContainerCustodyAgreement,
  customerNeedsContainerCustodyAcceptance,
  parseBusinessContainerCustodySettings,
  resolveContainerCustodyDocumentUrl,
} from "../../../../services/customers/container-custody-agreement";

describe("container-custody-agreement", () => {
  const business = {
    containerCustodyAgreement: {
      enabled: true,
      documentUrl: "https://example.com/custody.pdf",
      version: "2026-06-29",
    },
    containerDefaultPolicy: "wrs_rotation",
  };

  it("detects active business custody with custom PDF", () => {
    expect(businessHasActiveContainerCustodyAgreement(business)).toBe(true);
    const settings = parseBusinessContainerCustodySettings(
      business.containerCustodyAgreement,
    );
    expect(settings?.source).toBe("custom");
  });

  it("detects active default template without upload", () => {
    expect(
      businessHasActiveContainerCustodyAgreement({
        containerCustodyAgreement: { enabled: true },
      }),
    ).toBe(true);
    const settings = parseBusinessContainerCustodySettings({
      enabled: true,
    });
    expect(settings?.source).toBe("default");
    expect(
      resolveContainerCustodyDocumentUrl("biz-1", settings!, "https://api.test"),
    ).toBe("https://api.test/public/portal/container-custody-agreement?b=biz-1");
  });

  it("requires acceptance for WRS rotation suki", () => {
    expect(
      customerNeedsContainerCustodyAcceptance(
        { containerPolicy: "wrs_rotation" },
        business,
      ),
    ).toBe(true);
  });

  it("skips BYOG suki", () => {
    expect(
      customerNeedsContainerCustodyAcceptance({ containerPolicy: "byog" }, business),
    ).toBe(false);
  });

  it("skips when already accepted current version", () => {
    const acceptance = buildCustomerContainerCustodyAcceptance("2026-06-29", "crm");
    expect(
      customerNeedsContainerCustodyAcceptance(
        {
          containerPolicy: "wrs_rotation",
          containerCustodyAgreement: acceptance,
        },
        business,
      ),
    ).toBe(false);
  });
});
