import { describe, expect, it, vi, beforeEach } from "vitest";
import {
  getCustomerForAgent,
  listCustomersForAgent,
} from "../../../../services/ai/river-ai-agent/river-ai-agent-read-tools";

vi.mock("../../../../services/customers/customer-service", () => ({
  CustomerService: {
    getCustomersByBusiness: vi.fn(),
  },
}));

import { CustomerService } from "../../../../services/customers/customer-service";

describe("river-ai-agent-read-tools", () => {
  beforeEach(() => {
    vi.mocked(CustomerService.getCustomersByBusiness).mockReset();
  });

  it("filters customers by search text", async () => {
    vi.mocked(CustomerService.getCustomersByBusiness).mockResolvedValue([
      {
        id: "c1",
        businessId: "b1",
        name: "Juan Santos",
        phone: "09171234567",
        address: "BF Homes",
        type: "residential",
        isDeliveryEnabled: true,
        isCollectionEnabled: false,
        status: "active",
      },
      {
        id: "c2",
        businessId: "b1",
        name: "Maria Cruz",
        phone: "09180001111",
        address: "Alabang",
        type: "residential",
        isDeliveryEnabled: true,
        isCollectionEnabled: false,
        status: "active",
      },
    ]);

    const { rows, total } = await listCustomersForAgent("b1", { search: "juan" });
    expect(total).toBe(1);
    expect(rows[0]?.label).toBe("Juan Santos");
  });

  it("returns a single customer when search resolves uniquely", async () => {
    vi.mocked(CustomerService.getCustomersByBusiness).mockResolvedValue([
      {
        id: "c1",
        businessId: "b1",
        name: "Juan Santos",
        phone: "09171234567",
        address: "BF Homes",
        type: "residential",
        isDeliveryEnabled: true,
        isCollectionEnabled: false,
        status: "active",
      },
    ]);

    const { rows, total } = await getCustomerForAgent("b1", { search: "juan" });
    expect(total).toBe(1);
    expect(rows[0]?.label).toBe("Juan Santos");
  });

  it("returns multiple matches without broken joined search", async () => {
    vi.mocked(CustomerService.getCustomersByBusiness).mockResolvedValue([
      {
        id: "c1",
        businessId: "b1",
        name: "Juan Santos",
        phone: "09171234567",
        address: "BF Homes",
        type: "residential",
        isDeliveryEnabled: true,
        isCollectionEnabled: false,
        status: "active",
      },
      {
        id: "c2",
        businessId: "b1",
        name: "Juan Cruz",
        phone: "09180001111",
        address: "Alabang",
        type: "residential",
        isDeliveryEnabled: true,
        isCollectionEnabled: false,
        status: "active",
      },
    ]);

    const { rows, total } = await getCustomerForAgent("b1", { search: "juan" });
    expect(total).toBe(2);
    expect(rows.map((r) => r.label)).toEqual(["Juan Santos", "Juan Cruz"]);
  });
});
