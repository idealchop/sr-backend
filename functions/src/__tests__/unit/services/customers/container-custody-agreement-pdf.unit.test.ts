import { describe, expect, it } from "vitest";
import { buildDefaultContainerCustodyAgreementPdf } from "../../../../services/customers/container-custody-agreement-pdf";

describe("container-custody-agreement-pdf", () => {
  it("builds a non-empty PDF buffer", async () => {
    const pdf = await buildDefaultContainerCustodyAgreementPdf({
      stationName: "River Test WRS",
    });
    expect(Buffer.isBuffer(pdf)).toBe(true);
    expect(pdf.length).toBeGreaterThan(500);
    expect(pdf.subarray(0, 4).toString()).toBe("%PDF");
  });
});
