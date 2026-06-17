import { describe, expect, it, vi, beforeEach } from "vitest";

const { runTransactionMock, counterGetMock, counterSetMock } = vi.hoisted(() => ({
  runTransactionMock: vi.fn(),
  counterGetMock: vi.fn(),
  counterSetMock: vi.fn(),
}));

vi.mock("../../../../config/firebase-admin", () => ({
  db: {
    collection: vi.fn(() => ({
      doc: vi.fn(() => ({
        collection: vi.fn(() => ({
          doc: vi.fn(() => ({
            get: counterGetMock,
            set: counterSetMock,
          })),
        })),
      })),
    })),
    runTransaction: runTransactionMock,
  },
  FieldValue: { serverTimestamp: vi.fn(() => "ts") },
}));

import {
  allocateWalkInQueueNumber,
  manilaWalkInQueueDateKey,
} from "../../../../services/portal/walk-in-queue-service";

describe("walk-in-queue-service", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("formats Manila date key", () => {
    const key = manilaWalkInQueueDateKey(new Date("2026-06-02T04:00:00.000Z"));
    expect(key).toMatch(/^\d{8}$/);
  });

  it("allocates 1 on first ticket of the day", async () => {
    runTransactionMock.mockImplementation(async (fn: (tx: unknown) => Promise<unknown>) => {
      const tx = {
        get: vi.fn().mockResolvedValue({ data: () => undefined }),
        set: vi.fn(),
      };
      return fn(tx);
    });

    const result = await allocateWalkInQueueNumber(
      "biz-1",
      new Date("2026-06-02T10:00:00+08:00"),
    );

    expect(result.queueNumber).toBe(1);
    expect(result.queueDate).toBe("20260602");
  });

  it("increments from stored counter on same day", async () => {
    runTransactionMock.mockImplementation(async (fn: (tx: unknown) => Promise<unknown>) => {
      const tx = {
        get: vi.fn().mockResolvedValue({
          data: () => ({ dateKey: "20260602", nextNumber: 4 }),
        }),
        set: vi.fn(),
      };
      return fn(tx);
    });

    const result = await allocateWalkInQueueNumber(
      "biz-1",
      new Date("2026-06-02T15:00:00+08:00"),
    );

    expect(result.queueNumber).toBe(4);
  });

  it("resets to 1 when date key changes", async () => {
    runTransactionMock.mockImplementation(async (fn: (tx: unknown) => Promise<unknown>) => {
      const tx = {
        get: vi.fn().mockResolvedValue({
          data: () => ({ dateKey: "20260601", nextNumber: 12 }),
        }),
        set: vi.fn(),
      };
      return fn(tx);
    });

    const result = await allocateWalkInQueueNumber(
      "biz-1",
      new Date("2026-06-02T08:00:00+08:00"),
    );

    expect(result.queueNumber).toBe(1);
    expect(result.queueDate).toBe("20260602");
  });
});
