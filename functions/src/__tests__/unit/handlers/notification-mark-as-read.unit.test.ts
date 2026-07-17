import { beforeEach, describe, expect, it, vi } from "vitest";

const { mockGet, mockBatch, mockCommit, mockWhere } = vi.hoisted(() => {
  const commit = vi.fn().mockResolvedValue(undefined);
  const update = vi.fn();
  const batch = vi.fn(() => ({ update, commit }));
  const get = vi.fn();
  const where = vi.fn();
  return {
    mockGet: get,
    mockBatch: batch,
    mockCommit: commit,
    mockWhere: where,
  };
});

vi.mock("../../../config/firebase-admin", () => ({
  db: {
    batch: mockBatch,
    collection: vi.fn(() => ({
      doc: vi.fn(() => ({
        collection: vi.fn(() => {
          const query: Record<string, unknown> = {};
          query.where = (...args: unknown[]) => {
            mockWhere(...args);
            return query;
          };
          query.get = mockGet;
          return query;
        }),
      })),
    })),
  },
  FieldValue: {
    serverTimestamp: vi.fn(() => "ts"),
  },
}));

vi.mock("../../../services/observability/logging/logger", () => ({
  logger: { error: vi.fn(), info: vi.fn(), warn: vi.fn() },
}));

vi.mock("../../../utils/auth-utils", () => ({
  checkBusinessAccess: vi.fn().mockResolvedValue({ hasAccess: true }),
}));

import { markAsRead } from "../../../handlers/notification-handler";

function mockRes() {
  const res: any = {};
  res.status = vi.fn().mockReturnValue(res);
  res.json = vi.fn().mockReturnValue(res);
  return res;
}

describe("markAsRead", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("chunks notification ids beyond Firestore in-limit of 30", async () => {
    const ids = Array.from({ length: 35 }, (_, i) => `n-${i}`);
    mockGet
      .mockResolvedValueOnce({
        empty: false,
        docs: ids.slice(0, 30).map((id) => ({
          ref: { id },
        })),
      })
      .mockResolvedValueOnce({
        empty: false,
        docs: ids.slice(30).map((id) => ({
          ref: { id },
        })),
      });

    const req = {
      user: { uid: "u1" },
      params: {},
      body: { businessId: "biz-1", notificationIds: ids },
    } as any;
    const res = mockRes();

    await markAsRead(req, res);

    expect(mockGet).toHaveBeenCalledTimes(2);
    expect(mockCommit).toHaveBeenCalledTimes(2);
    expect(res.json).toHaveBeenCalledWith({ success: true, count: 35 });
  });
});
