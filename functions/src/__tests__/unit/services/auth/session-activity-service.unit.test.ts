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
          doc: vi.fn((dayKey: string) => ({ id: dayKey, path: `login_events/${dayKey}` })),
        })),
      })),
    })),
    runTransaction: mocks.runTransaction,
  },
  FieldValue: {
    serverTimestamp: vi.fn(() => "SERVER_TS"),
  },
}));

import {
  utcCalendarDayKey,
  writeUserLoginEvent,
} from "../../../../services/auth/session-activity-service";

const baseReq = {
  path: "/auth/login",
  originalUrl: "/auth/login",
  method: "POST",
  headers: { "user-agent": "TestBrowser/1.0" },
  ip: "127.0.0.1",
  socket: {},
} as Parameters<typeof writeUserLoginEvent>[0]["req"];

describe("session-activity-service", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.runTransaction.mockImplementation(async (fn) =>
      fn({
        get: mocks.txGet,
        set: mocks.txSet,
      }),
    );
  });

  describe("utcCalendarDayKey", () => {
    it("returns UTC YYYY-MM-DD", () => {
      expect(utcCalendarDayKey(new Date("2026-05-28T23:30:00.000Z"))).toBe(
        "2026-05-28",
      );
      expect(utcCalendarDayKey(new Date("2026-05-29T00:30:00.000Z"))).toBe(
        "2026-05-29",
      );
    });
  });

  describe("writeUserLoginEvent", () => {
    it("writes one doc per UTC day when none exists", async () => {
      mocks.txGet.mockResolvedValue({ exists: false });
      const dayKey = utcCalendarDayKey();

      const written = await writeUserLoginEvent({
        uid: "uid-1",
        email: "user@test.com",
        req: baseReq,
        kind: "explicit_login",
        appId: "smartrefill",
      });

      expect(written).toBe(true);
      expect(mocks.txSet).toHaveBeenCalledWith(
        expect.anything(),
        expect.objectContaining({
          calendarDayUtc: dayKey,
          kind: "explicit_login",
          appId: "smartrefill",
          email: "user@test.com",
          timestamp: "SERVER_TS",
        }),
      );
    });

    it("skips when a daily event already exists (any device/browser)", async () => {
      mocks.txGet.mockResolvedValue({ exists: true });

      const written = await writeUserLoginEvent({
        uid: "uid-1",
        req: baseReq,
        kind: "explicit_login",
      });

      expect(written).toBe(false);
      expect(mocks.txSet).not.toHaveBeenCalled();
    });
  });
});
