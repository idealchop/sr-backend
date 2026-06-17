import { describe, expect, it } from "vitest";
import {
  countActiveCustomers,
  isCustomerActiveForLimit,
} from "../../../../services/customers/customer-active-limit-service";
import type { Customer } from "../../../../services/customers/customer-service";

function customer(status?: Customer["status"]): Customer {
  return {
    businessId: "b1",
    name: "Test",
    type: "residential",
    phone: "1",
    address: "a",
    latitude: 0,
    longitude: 0,
    isDeliveryEnabled: false,
    isCollectionEnabled: false,
    status: status ?? "active",
  };
}

describe("customer-active-limit", () => {
  it("counts only non-inactive sukis toward the cap", () => {
    expect(
      countActiveCustomers([
        customer("active"),
        customer("inactive"),
        customer(undefined),
      ]),
    ).toBe(2);
  });

  it("isCustomerActiveForLimit treats missing status as active", () => {
    expect(isCustomerActiveForLimit(undefined)).toBe(true);
    expect(isCustomerActiveForLimit("inactive")).toBe(false);
  });
});
