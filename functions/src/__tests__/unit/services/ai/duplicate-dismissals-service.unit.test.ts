import { describe, expect, it, vi, beforeEach } from "vitest";
import {
  dismissDuplicateCustomer,
  excludeDismissedDuplicateCustomers,
  readDismissedDuplicateCustomerIds,
} from "../../../../services/ai/duplicate-dismissals-service";
import type { Customer } from "../../../../services/customers/customer-service";

const update = vi.fn();
const get = vi.fn();

vi.mock("../../../../config/firebase-admin", () => ({
  db: {
    collection: vi.fn(() => ({
      doc: vi.fn(() => ({ get, update })),
    })),
  },
  FieldValue: {
    serverTimestamp: vi.fn(() => "mock-timestamp"),
  },
}));

function customer(
  partial: Partial<Customer> & Pick<Customer, "id" | "name" | "businessId">,
): Customer {
  return {
    type: "residential",
    phone: partial.phone ?? "09171234567",
    address: partial.address ?? "123 Main St, Quezon City",
    status: "active",
    ...partial,
  };
}

describe("duplicate-dismissals-service", () => {
  beforeEach(() => {
    update.mockReset();
    get.mockReset();
  });

  it("reads per-customer dismissed ids and legacy group keys", () => {
    const ids = readDismissedDuplicateCustomerIds({
      dismissedDuplicateCustomerIds: ["a"],
      dismissedDuplicateGroupKeys: ["b|c"],
    });
    expect(ids.has("a")).toBe(true);
    expect(ids.has("b")).toBe(true);
    expect(ids.has("c")).toBe(true);
  });

  it("excludes kept suki from duplicate scans", () => {
    const dismissed = new Set(["a"]);
    const active = excludeDismissedDuplicateCustomers(
      [
        customer({ id: "a", businessId: "biz1", name: "A" }),
        customer({ id: "b", businessId: "biz1", name: "B" }),
      ],
      dismissed,
    );

    expect(active.map((row) => row.id)).toEqual(["b"]);
  });

  it("persists dismissed customer ids on dismiss", async () => {
    get.mockResolvedValue({
      exists: true,
      data: () => ({
        uiConfig: { dismissedDuplicateCustomerIds: ["existing"] },
      }),
    });
    update.mockResolvedValue(undefined);

    const result = await dismissDuplicateCustomer({
      businessId: "biz1",
      customerId: "new-id",
    });

    expect(result.dismissedDuplicateCustomerIds).toEqual(["existing", "new-id"]);
    expect(update).toHaveBeenCalledWith(
      expect.objectContaining({
        uiConfig: expect.objectContaining({
          dismissedDuplicateCustomerIds: ["existing", "new-id"],
        }),
      }),
    );
  });
});
