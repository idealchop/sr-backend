import { describe, it, expect, vi, beforeEach } from "vitest";
import { CustomerService } from "../../../../services/customers/customer-service";

// --- Mocks ---
const { mockCollection } = vi.hoisted(() => {
  const mc = {
    doc: vi.fn(),
    add: vi.fn(),
    collection: vi.fn(),
    where: vi.fn(),
    get: vi.fn(),
  };
  return { mockCollection: mc };
});

vi.mock("../../../../config/firebase-admin", () => ({
  db: {
    collection: vi.fn(() => mockCollection),
  },
  FieldValue: {
    serverTimestamp: vi.fn(() => "mock-timestamp"),
  },
}));

vi.mock("../../../../services/observability/logging/logger", () => ({
  logger: {
    info: vi.fn(),
    error: vi.fn(),
  },
}));

describe("CustomerService Unit Tests", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockCollection.collection.mockReturnValue(mockCollection);
    mockCollection.doc.mockReturnValue(mockCollection);
    mockCollection.where.mockReturnValue(mockCollection);
  });

  describe("addCustomer", () => {
    it("saves customer without address or map coordinates", async () => {
      mockCollection.add.mockResolvedValue({ id: "cust-no-map" });

      const created = await CustomerService.addCustomer("biz-123", {
        name: "Walk-in Suki",
        phone: "09171234567",
        address: "",
      });

      expect(mockCollection.add).toHaveBeenCalledWith(
        expect.objectContaining({
          name: "Walk-in Suki",
          phone: "09171234567",
          address: "",
        }),
      );
      expect(mockCollection.add.mock.calls[0][0]).not.toHaveProperty("latitude");
      expect(mockCollection.add.mock.calls[0][0]).not.toHaveProperty("longitude");
      expect(created.id).toBe("cust-no-map");
    });
  });

  describe("getSingleCustomerStats", () => {
    it("should calculate correct stats for a customer with transactions", async () => {
      // Mock getCustomer
      const mockCustomer = {
        id: "cust-123",
        name: "Test Customer",
        createdAt: { toDate: () => new Date("2024-01-01") },
      };

      const getCustomerSpy = vi
        .spyOn(CustomerService, "getCustomer")
        .mockResolvedValue(mockCustomer as any);

      // Mock transactions snapshot — balanceDue only counts fulfilled unpaid/partial
      // receivables (see isUnpaidReceivableTransaction).
      const mockTransactions = [
        {
          id: "tx-1",
          data: () => ({
            type: "delivery",
            deliveryStatus: "completed",
            paymentStatus: "partial",
            totalAmount: 100,
            balanceDue: 20,
            scheduledAt: { toDate: () => new Date("2024-05-01") },
          }),
        },
        {
          id: "tx-2",
          data: () => ({
            type: "delivery",
            deliveryStatus: "completed",
            paymentStatus: "paid",
            totalAmount: 150,
            balanceDue: 0,
            scheduledAt: { toDate: () => new Date("2024-05-10") },
          }),
        },
      ];

      mockCollection.get.mockResolvedValue({
        forEach: (callback: any) => mockTransactions.forEach(callback),
      });

      const stats = await CustomerService.getSingleCustomerStats(
        "biz-123",
        "cust-123",
      );

      expect(stats.totalRevenue).toBe(250);
      expect(stats.balanceDue).toBe(20);
      expect(stats.totalOrders).toBe(2);
      expect(stats.lastOrderAt).toEqual(new Date("2024-05-10"));
      expect(getCustomerSpy).toHaveBeenCalledWith("biz-123", "cust-123");
    });

    it("should throw error if customer is not found", async () => {
      vi.spyOn(CustomerService, "getCustomer").mockResolvedValue(null);

      await expect(
        CustomerService.getSingleCustomerStats("biz-123", "non-existent"),
      ).rejects.toThrow("Customer not found");
    });
  });
});
