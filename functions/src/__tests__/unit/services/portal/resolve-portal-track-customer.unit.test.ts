import { describe, expect, it, vi, beforeEach } from "vitest";

vi.mock("../../../../config/firebase-admin", () => ({
  db: {
    collection: vi.fn(),
  },
}));

vi.mock("../../../../services/customers/qr-customer-service", () => ({
  QrCustomerService: {
    assertValidPortalToken: vi.fn(),
  },
}));

vi.mock("../../../../services/customers/customer-service", () => ({
  CustomerService: {
    getCustomer: vi.fn(),
  },
}));

vi.mock("../../../../services/transactions/transaction-service", () => ({
  TransactionService: {
    getTransaction: vi.fn(),
  },
}));

import { db } from "../../../../config/firebase-admin";
import { QrCustomerService } from "../../../../services/customers/qr-customer-service";
import { CustomerService } from "../../../../services/customers/customer-service";
import { TransactionService } from "../../../../services/transactions/transaction-service";
import { resolvePortalTrackCustomerId } from "../../../../services/portal/resolve-portal-track-customer";

describe("resolvePortalTrackCustomerId", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("returns customer from valid portal session", async () => {
    vi.mocked(QrCustomerService.assertValidPortalToken).mockResolvedValue({} as never);

    const id = await resolvePortalTrackCustomerId("biz1", {
      customerId: "cust1",
      token: "tok1",
    });

    expect(id).toBe("cust1");
  });

  it("resolves customer from raw submission reference", async () => {
    const subGet = vi.fn().mockResolvedValue({
      empty: false,
      docs: [{ data: () => ({ customerId: "cust-from-sub" }) }],
    });
    const txGet = vi.fn().mockResolvedValue({ empty: true, docs: [] });
    const businessDoc = {
      collection: vi.fn((name: string) => {
        if (name === "transactions") return { where: vi.fn().mockReturnValue({ limit: vi.fn().mockReturnValue({ get: txGet }) }) };
        if (name === "raw_submissions") return { where: vi.fn().mockReturnValue({ limit: vi.fn().mockReturnValue({ get: subGet }) }) };
        return { doc: vi.fn() };
      }),
    };
    vi.mocked(db.collection).mockReturnValue({
      doc: vi.fn().mockReturnValue(businessDoc),
    } as never);
    vi.mocked(TransactionService.getTransaction).mockResolvedValue(null);

    const id = await resolvePortalTrackCustomerId("biz1", {
      transactionReferenceId: "TX-123",
    });

    expect(id).toBe("cust-from-sub");
  });

  it("falls back to customerIdHint when linked customer exists", async () => {
    vi.mocked(TransactionService.getTransaction).mockResolvedValue(null);
    vi.mocked(CustomerService.getCustomer).mockResolvedValue({ id: "cust-hint" } as never);

    const id = await resolvePortalTrackCustomerId("biz1", {
      customerIdHint: "cust-hint",
    });

    expect(id).toBe("cust-hint");
  });
});
