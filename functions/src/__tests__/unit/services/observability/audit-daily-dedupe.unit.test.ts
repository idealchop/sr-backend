import { describe, it, expect, vi, beforeEach } from "vitest";

const mocks = vi.hoisted(() => ({
  runTransaction: vi.fn(),
  txGet: vi.fn(),
  txSet: vi.fn(),
}));

vi.mock("../../../../config/firebase-admin", () => ({
  db: {
    collection: vi.fn(() => ({
      doc: vi.fn(() => ({
        collection: vi.fn(() => ({
          doc: vi.fn((id: string) => ({ id, path: `audit_logs/${id}` })),
        })),
      })),
    })),
    runTransaction: mocks.runTransaction,
  },
  FieldValue: {
    serverTimestamp: vi.fn(() => "SERVER_TS"),
  },
}));

import { logAuditEventOncePerUtcDay } from
  "../../../../services/observability/logging/audit-daily-dedupe";
import { utcCalendarDayKey } from "../../../../services/auth/session-activity-service";

describe("audit-daily-dedupe (audit_logs)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.runTransaction.mockImplementation(async (fn) =>
      fn({
        get: mocks.txGet,
        set: mocks.txSet,
      }),
    );
  });

  it("creates one audit_logs row on first access of the UTC day", async () => {
    mocks.txGet.mockResolvedValue({ exists: false });
    const dayKey = utcCalendarDayKey();

    const logged = await logAuditEventOncePerUtcDay("SUBSCRIPTION_STATUS_ACCESSED", {
      businessId: "biz-1",
      userId: "uid-1",
    });

    expect(logged).toBe(true);
    expect(mocks.txSet).toHaveBeenCalledWith(
      expect.objectContaining({ path: expect.stringContaining("audit_logs/") }),
      expect.objectContaining({
        level: "info",
        message: "AUDIT: SUBSCRIPTION_STATUS_ACCESSED",
        event: "SUBSCRIPTION_STATUS_ACCESSED",
        businessId: "biz-1",
        userId: "uid-1",
        auditType: "business_event",
        calendarDayUtc: dayKey,
        timestamp: "SERVER_TS",
      }),
    );
  });

  it("skips when audit_logs doc already exists for that UTC day", async () => {
    mocks.txGet.mockResolvedValue({ exists: true });

    const logged = await logAuditEventOncePerUtcDay("SUBSCRIPTION_STATUS_ACCESSED", {
      businessId: "biz-1",
      userId: "uid-2",
    });

    expect(logged).toBe(false);
    expect(mocks.txSet).not.toHaveBeenCalled();
  });
});
