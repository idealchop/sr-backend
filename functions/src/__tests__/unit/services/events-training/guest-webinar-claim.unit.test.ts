import { describe, expect, it, vi } from "vitest";

vi.mock("../../../../config/firebase-admin", () => ({
  db: {},
  FieldValue: { serverTimestamp: () => "SERVER_TS" },
}));

vi.mock("../../../../services/events-training/events-training-collections", () => {
  const store = new Map<string, Record<string, unknown>>();
  return {
    __store: store,
    webinarRegistrationsCollection: () => ({
      doc: (id: string) => ({
        get: async () => ({
          exists: store.has(id),
          data: () => store.get(id) ?? {},
        }),
        set: async (data: Record<string, unknown>, opts?: { merge?: boolean }) => {
          const prev = store.get(id) ?? {};
          store.set(id, opts?.merge ? { ...prev, ...data } : data);
        },
      }),
      where: () => ({
        limit: () => ({
          get: async () => ({
            size: 0,
            docs: [],
          }),
        }),
      }),
    }),
  };
});

vi.mock("../../../../services/events-training/member-registration-service", () => ({
  isWebinarAtCapacity: () => false,
}));

import { guestRegistrationDocId } from "../../../../services/events-training/guest-webinar-registration-service";
import { claimGuestWebinarRegistration } from "../../../../services/events-training/guest-webinar-claim-service";
import * as collections from "../../../../services/events-training/events-training-collections";

describe("claimGuestWebinarRegistration", () => {
  const store = (collections as unknown as {
    __store: Map<string, Record<string, unknown>>;
  }).__store;

  it("links a guest registration to the member workspace", async () => {
    store.clear();
    const eventId = "evt-1";
    const email = "ada@example.com";
    const id = guestRegistrationDocId(eventId, email);
    store.set(id, {
      kind: "guest",
      eventId,
      email,
      status: "accepted",
      attendanceStatus: "attended",
      userId: null,
      businessId: null,
    });

    const result = await claimGuestWebinarRegistration({
      eventId,
      userId: "uid-1",
      businessId: "biz-1",
      email,
    });

    expect(result.claimed).toBe(true);
    expect(result.alreadyClaimed).toBe(false);
    expect(store.get(id)?.kind).toBe("member");
    expect(store.get(id)?.userId).toBe("uid-1");
    expect(store.get(id)?.businessId).toBe("biz-1");
  });

  it("is idempotent when already claimed by same user", async () => {
    store.clear();
    const eventId = "evt-2";
    const email = "ada@example.com";
    const id = guestRegistrationDocId(eventId, email);
    store.set(id, {
      kind: "member",
      eventId,
      email,
      status: "accepted",
      userId: "uid-1",
      businessId: "biz-1",
      claimedAt: "2026-07-30T00:00:00.000Z",
    });

    const result = await claimGuestWebinarRegistration({
      eventId,
      userId: "uid-1",
      businessId: "biz-1",
      email,
    });

    expect(result.alreadyClaimed).toBe(true);
    expect(result.claimed).toBe(false);
  });

  it("rejects claim for another account", async () => {
    store.clear();
    const eventId = "evt-3";
    const email = "ada@example.com";
    const id = guestRegistrationDocId(eventId, email);
    store.set(id, {
      kind: "member",
      eventId,
      email,
      status: "accepted",
      userId: "uid-other",
      businessId: "biz-other",
      claimedAt: "2026-07-30T00:00:00.000Z",
    });

    await expect(
      claimGuestWebinarRegistration({
        eventId,
        userId: "uid-1",
        businessId: "biz-1",
        email,
      }),
    ).rejects.toMatchObject({ code: "ALREADY_CLAIMED_OTHER", status: 409 });
  });
});
