import { describe, expect, it } from "vitest";
import { detectDuplicateCustomerGroups } from "../../../../services/ai/duplicate-customers-service";
import type { Customer } from "../../../../services/customers/customer-service";

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

describe("detectDuplicateCustomerGroups", () => {
  it("clusters on phone, email, and fuzzy name", () => {
    const groups = detectDuplicateCustomerGroups([
      customer({
        id: "a",
        businessId: "biz1",
        name: "Hey Lucky Cafe",
        phone: "09171112222",
        email: "lucky@example.com",
      }),
      customer({
        id: "b",
        businessId: "biz1",
        name: "Hey Lucky Kafe",
        phone: "09171112222",
        email: "lucky@example.com",
      }),
    ]);

    expect(groups).toHaveLength(1);
    expect(groups[0].reason).toContain("Same phone");
    expect(groups[0].reason).toContain("Same email");
    expect(groups[0].reason).toMatch(/Name \d+% match/);
  });

  it("handles numeric phone values from Firestore", () => {
    const groups = detectDuplicateCustomerGroups([
      customer({
        id: "a",
        businessId: "biz1",
        name: "Juan",
        phone: 9171112222 as unknown as string,
      }),
      customer({
        id: "b",
        businessId: "biz1",
        name: "Juan D",
        phone: "09171112222",
      }),
    ]);

    expect(groups).toHaveLength(1);
    expect(groups[0].reason).toContain("Same phone");
  });
});
