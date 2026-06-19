import { describe, expect, it } from "vitest";
import {
  listPortalProfileChanges,
  resolvePortalCustomerStatus,
  summarizePortalProfileChanges,
} from "../../../../services/portal/portal-profile-diff";
import type { Customer } from "../../../../services/customers/customer-service";

const baseCustomer: Customer = {
  id: "cust-1",
  name: "Maria Santos",
  phone: "09171234567",
  email: "maria@example.com",
  address: "123 Main St",
  latitude: 14.6,
  longitude: 121.0,
  type: "residential",
};

describe("portal-profile-diff", () => {
  it("classifies linked portal sessions as recognized", () => {
    expect(resolvePortalCustomerStatus("cust-1")).toBe("recognized");
    expect(resolvePortalCustomerStatus("")).toBe("new");
  });

  it("detects meaningful profile changes for recognized sukis", () => {
    const changes = listPortalProfileChanges(baseCustomer, {
      profile: {
        name: "Maria Santos",
        phone: "09179876543",
        email: "maria@example.com",
      },
      address: { line: "123 Main St", latitude: 14.6, longitude: 121.0 },
    });
    expect(changes).toEqual(["phone"]);
    expect(summarizePortalProfileChanges(changes)).toBe("phone");
  });

  it("ignores profile noise when values match", () => {
    const changes = listPortalProfileChanges(baseCustomer, {
      profile: {
        name: "Maria Santos",
        phone: "09171234567",
        email: "maria@example.com",
      },
      address: { line: "123 Main St", latitude: 14.6, longitude: 121.0 },
    });
    expect(changes).toEqual([]);
  });
});
