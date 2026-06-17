import { describe, expect, it, vi, beforeEach } from "vitest";
import type { RawSubmission } from "../../../../services/portal/raw-submission-types";

const {
  addTransactionMock,
  getCustomerMock,
  getItemMock,
  updateStatusMock,
  updateCustomerMock,
} = vi.hoisted(() => ({
  addTransactionMock: vi.fn(),
  getCustomerMock: vi.fn(),
  getItemMock: vi.fn(),
  updateStatusMock: vi.fn(),
  updateCustomerMock: vi.fn(),
}));

vi.mock("../../../../config/firebase-admin", () => ({
  db: {
    collection: vi.fn(() => ({
      doc: vi.fn(() => ({
        get: vi.fn().mockResolvedValue({
          exists: true,
          data: () => ({
            waterTypes: [{ name: "Alkaline", price: 30 }],
          }),
        }),
        collection: vi.fn(() => ({
          doc: vi.fn(() => ({
            update: vi.fn().mockResolvedValue(undefined),
          })),
        })),
        update: vi.fn().mockResolvedValue(undefined),
      })),
    })),
  },
  FieldValue: { serverTimestamp: vi.fn(() => "ts") },
}));

vi.mock("../../../../services/transactions/transaction-service", () => ({
  TransactionService: { addTransaction: addTransactionMock },
}));

vi.mock("../../../../services/customers/customer-service", () => ({
  CustomerService: {
    getCustomer: getCustomerMock,
    updateCustomer: updateCustomerMock,
    addCustomer: vi.fn(),
  },
}));

vi.mock("../../../../services/inventory/inventory-service", () => ({
  InventoryService: { getItem: getItemMock },
}));

vi.mock("../../../../services/portal/raw-submission-service", () => ({
  RawSubmissionService: {
    updateStatus: updateStatusMock,
    markCustomerRegisteredFromPortal: vi.fn(),
  },
}));

vi.mock("../../../../services/observability/logging/logger", () => ({
  logger: { info: vi.fn(), error: vi.fn(), warn: vi.fn() },
}));

vi.mock("../../../../services/portal/portal-completion-receipt-notifier", () => ({
  maybeSendPortalCompletionReceiptEmail: vi.fn(),
  mergePortalProfileFromSubmission: vi.fn(),
}));

import { RawSubmissionProcessor } from "../../../../services/portal/raw-submission-processor";

function buildPlaceOrderSubmission(
  overrides: Partial<RawSubmission> = {},
): RawSubmission {
  return {
    id: "sub-1",
    businessId: "biz-1",
    customerId: "cust-1",
    referenceId: "TX-260605-XVTX",
    submissionType: "PLACE_ORDER",
    status: "pending_review",
    payload: {
      refillItems: [{ type: "Mineral", qty: 1, unitPrice: 25 }],
      inventoryItems: [{ inventoryId: "round-1", qty: 1 }],
      deliveryStatus: "placed",
      riderId: "rider-1",
      riderName: "Juan",
    },
    metadata: { legalAgreed: true },
    ...overrides,
  };
}

describe("RawSubmissionProcessor PLACE_ORDER", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    getCustomerMock.mockResolvedValue({
      id: "cust-1",
      name: "Ditas",
      pricing: {},
    });
    getItemMock.mockResolvedValue({ name: "Round Container" });
    addTransactionMock.mockResolvedValue(undefined);
    updateStatusMock.mockResolvedValue(undefined);
    updateCustomerMock.mockResolvedValue(undefined);
  });

  it("stores water refills on waterRefills only, not as inventory items", async () => {
    await RawSubmissionProcessor.accept(
      "biz-1",
      buildPlaceOrderSubmission(),
      "staff-1",
    );

    expect(addTransactionMock).toHaveBeenCalledOnce();
    const txPayload = addTransactionMock.mock.calls[0][1];

    expect(txPayload.waterRefills).toEqual([
      expect.objectContaining({
        waterTypeId: "Mineral",
        quantity: 1,
        unitPrice: 25,
        subtotal: 25,
      }),
    ]);
    expect(txPayload.items).toEqual([
      expect.objectContaining({
        inventoryId: "round-1",
        quantity: 1,
      }),
    ]);
    expect(
      txPayload.items.some(
        (row: { inventoryId?: string }) => row.inventoryId === "Mineral",
      ),
    ).toBe(false);
  });

  it("defaults delivery to placed and passes rider assignment", async () => {
    await RawSubmissionProcessor.accept(
      "biz-1",
      buildPlaceOrderSubmission({
        payload: {
          refillItems: [{ type: "Alkaline", qty: 2 }],
        },
      }),
      "staff-1",
    );

    const txPayload = addTransactionMock.mock.calls[0][1];
    expect(txPayload.deliveryStatus).toBe("placed");
    expect(txPayload.riderId).toBeUndefined();
    expect(txPayload.riderName).toBeUndefined();
  });

  it("honors adjusted unit price and explicit rider on payload", async () => {
    await RawSubmissionProcessor.accept(
      "biz-1",
      buildPlaceOrderSubmission(),
      "staff-1",
    );

    const txPayload = addTransactionMock.mock.calls[0][1];
    expect(txPayload.deliveryStatus).toBe("placed");
    expect(txPayload.riderId).toBe("rider-1");
    expect(txPayload.riderName).toBe("Juan");
    expect(txPayload.waterRefills[0].unitPrice).toBe(25);
  });

  it("copies walk-in queue number onto walk-in transactions", async () => {
    await RawSubmissionProcessor.accept(
      "biz-1",
      buildPlaceOrderSubmission({
        payload: {
          type: "walkin",
          refillItems: [{ type: "Mineral", qty: 1 }],
        },
        metadata: { legalAgreed: true, walkInQueueNumber: 7 },
      }),
      "staff-1",
    );

    const txPayload = addTransactionMock.mock.calls[0][1];
    expect(txPayload.type).toBe("walkin");
    expect(txPayload.walkInQueueNumber).toBe(7);
  });
});
