import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Customer } from "../../../../services/customers/customer-service";
import { CustomerActiveLimitError } from
  "../../../../services/customers/customer-active-limit-service";

const { assertCanActivateCustomerMock, updateCustomerMock } = vi.hoisted(() => ({
  assertCanActivateCustomerMock: vi.fn(),
  updateCustomerMock: vi.fn(),
}));

vi.mock(
  "../../../../services/customers/customer-active-limit-service",
  async (importOriginal) => {
    const actual = await importOriginal<
      typeof import(
        "../../../../services/customers/customer-active-limit-service"
      )
    >();
    return {
      ...actual,
      CustomerActiveLimitService: {
        assertCanActivateCustomer: assertCanActivateCustomerMock,
      },
    };
  },
);

vi.mock("../../../../services/customers/customer-service", () => ({
  CustomerService: {
    updateCustomer: updateCustomerMock,
  },
}));

import {
  ensureCustomerActiveForPortalAcceptance,
  PortalCustomerActivationBlockedError,
} from "../../../../services/portal/portal-customer-activation";

function inactiveCustomer(): Customer {
  return {
    id: "cust-1",
    businessId: "biz-1",
    name: "Ditas",
    type: "residential",
    phone: "1",
    address: "a",
    latitude: 0,
    longitude: 0,
    isDeliveryEnabled: true,
    isCollectionEnabled: false,
    status: "inactive",
  };
}

describe("ensureCustomerActiveForPortalAcceptance", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    assertCanActivateCustomerMock.mockResolvedValue(undefined);
    updateCustomerMock.mockResolvedValue(undefined);
  });

  it("returns active customers unchanged", async () => {
    const customer = { ...inactiveCustomer(), status: "active" as const };
    const result = await ensureCustomerActiveForPortalAcceptance("biz-1", customer);
    expect(result).toBe(customer);
    expect(assertCanActivateCustomerMock).not.toHaveBeenCalled();
    expect(updateCustomerMock).not.toHaveBeenCalled();
  });

  it("reactivates inactive suki when under the active cap", async () => {
    const customer = inactiveCustomer();
    const result = await ensureCustomerActiveForPortalAcceptance("biz-1", customer);

    expect(assertCanActivateCustomerMock).toHaveBeenCalledWith("biz-1");
    expect(updateCustomerMock).toHaveBeenCalledWith("biz-1", "cust-1", { status: "active" });
    expect(result.status).toBe("active");
  });

  it("throws PortalCustomerActivationBlockedError when the active cap is full", async () => {
    assertCanActivateCustomerMock.mockRejectedValue(
      new CustomerActiveLimitError("Active suki limit reached", 50, 50),
    );

    await expect(
      ensureCustomerActiveForPortalAcceptance("biz-1", inactiveCustomer()),
    ).rejects.toBeInstanceOf(PortalCustomerActivationBlockedError);

    expect(updateCustomerMock).not.toHaveBeenCalled();
  });
});
