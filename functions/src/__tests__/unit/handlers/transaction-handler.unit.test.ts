import { describe, expect, it, vi, beforeEach } from "vitest";
import type { Request, Response } from "express";
import { transactionHandler } from "../../../handlers/transactions/transaction-handler";
import { TransactionService } from "../../../services/transactions/transaction-service";

vi.mock("../../../services/transactions/transaction-service", () => ({
  TransactionService: {
    addTransaction: vi.fn(),
    getTransaction: vi.fn(),
    updateTransaction: vi.fn(),
  },
}));

vi.mock("../../../services/portal/customer-transaction-notifier", () => ({
  maybeSendCustomerTxnNotification: vi.fn(),
}));

function mockRes() {
  const res = {
    statusCode: 200,
    body: null as unknown,
    status(code: number) {
      this.statusCode = code;
      return this;
    },
    json(payload: unknown) {
      this.body = payload;
      return this;
    },
  };
  return res as Response & { statusCode: number; body: Record<string, unknown> };
}

describe("transactionHandler.createTransaction (OFF-07)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("returns 201 for new creates", async () => {
    vi.mocked(TransactionService.addTransaction).mockResolvedValue({
      created: true,
      transaction: { id: "tx-1", referenceId: "TX-1" } as never,
    });

    const req = {
      params: { businessId: "biz-1" },
      body: { type: "walkin", clientMutationId: "cm-1" },
      user: { uid: "u1" },
    } as unknown as Request;
    const res = mockRes();

    await transactionHandler.createTransaction(req, res);

    expect(res.statusCode).toBe(201);
    expect(res.body).toMatchObject({ idempotent: false, data: { id: "tx-1" } });
  });

  it("returns 200 for idempotent replays", async () => {
    vi.mocked(TransactionService.addTransaction).mockResolvedValue({
      created: false,
      transaction: { id: "tx-1", clientMutationId: "cm-1" } as never,
    });

    const req = {
      params: { businessId: "biz-1" },
      body: { type: "walkin", clientMutationId: "cm-1" },
      user: { uid: "u1" },
    } as unknown as Request;
    const res = mockRes();

    await transactionHandler.createTransaction(req, res);

    expect(res.statusCode).toBe(200);
    expect(res.body).toMatchObject({ idempotent: true });
  });
});

describe("transactionHandler.updateTransaction (OFF-07)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("marks idempotent payment patches", async () => {
    vi.mocked(TransactionService.getTransaction).mockResolvedValue({
      id: "tx-1",
      paymentStatus: "paid",
    } as never);
    vi.mocked(TransactionService.updateTransaction).mockResolvedValue(false);

    const req = {
      params: { businessId: "biz-1", id: "tx-1" },
      body: { payments: [], amountPaid: 100 },
      user: { uid: "u1" },
    } as unknown as Request;
    const res = mockRes();

    await transactionHandler.updateTransaction(req, res);

    expect(res.body).toMatchObject({ success: true, idempotent: true });
  });
});
