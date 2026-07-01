import { describe, expect, it } from "vitest";
import { maskPortalCustomerName } from "../../../../services/portal/mask-portal-customer-name";

describe("maskPortalCustomerName", () => {
  it("masks multi-word names as J****e", () => {
    expect(maskPortalCustomerName("John Doe")).toBe("J****e");
  });

  it("masks single long names", () => {
    expect(maskPortalCustomerName("Justfer")).toBe("J*****r");
  });

  it("handles empty names", () => {
    expect(maskPortalCustomerName("")).toBe("Customer");
    expect(maskPortalCustomerName("   ")).toBe("Customer");
  });
});
