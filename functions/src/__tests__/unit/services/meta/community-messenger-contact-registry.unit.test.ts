import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  COMMUNITY_MESSENGER_INACTIVITY_RESET_MS,
  hasCommunityMessengerContact,
  isCommunityMessengerSessionExpired,
  markCommunityMessengerContactGreeted,
  touchCommunityMessengerInboundActivity,
} from "../../../../services/meta/community-messenger-contact-registry";

const { mockGet, mockSet, mockDoc, mockCollection } = vi.hoisted(() => {
  const mockGet = vi.fn();
  const mockSet = vi.fn();
  const mockDoc = vi.fn(() => ({ get: mockGet, set: mockSet }));
  const mockCollection = vi.fn(() => ({ doc: mockDoc }));
  return { mockGet, mockSet, mockDoc, mockCollection };
});

vi.mock("../../../../config/firebase-admin", () => ({
  db: { collection: mockCollection },
  FieldValue: { serverTimestamp: () => ({ __ts: true }) },
}));

const contact = {
  sourceChannel: "community_messenger" as const,
  contactId: "psid-123",
};

describe("community-messenger-contact-registry", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockGet.mockResolvedValue({ exists: false });
    mockSet.mockResolvedValue(undefined);
  });

  it("returns false for a new PSID", async () => {
    await expect(hasCommunityMessengerContact(contact)).resolves.toBe(false);
    expect(mockDoc).toHaveBeenCalledWith("community_messenger:psid-123");
  });

  it("returns true for a known PSID", async () => {
    mockGet.mockResolvedValueOnce({ exists: true });
    await expect(hasCommunityMessengerContact(contact)).resolves.toBe(true);
  });

  it("marks first greeting with firstGreetedAt", async () => {
    await markCommunityMessengerContactGreeted(contact);
    expect(mockSet).toHaveBeenCalledWith(
      expect.objectContaining({
        sourceChannel: "community_messenger",
        metaPsid: "psid-123",
        channelContactId: "psid-123",
        firstGreetedAt: { __ts: true },
        lastGreetedAt: { __ts: true },
      }),
      { merge: true },
    );
  });

  it("updates lastGreetedAt only for returning PSID", async () => {
    mockGet.mockResolvedValueOnce({ exists: true });
    await markCommunityMessengerContactGreeted(contact);
    expect(mockSet).toHaveBeenCalledWith(
      expect.not.objectContaining({ firstGreetedAt: expect.anything() }),
      { merge: true },
    );
    expect(mockSet).toHaveBeenCalledWith(
      expect.objectContaining({ lastGreetedAt: { __ts: true } }),
      { merge: true },
    );
  });

  it("treats session as active within 24h of last inbound", async () => {
    const recent = Date.now() - COMMUNITY_MESSENGER_INACTIVITY_RESET_MS + 60_000;
    mockGet.mockResolvedValueOnce({
      exists: true,
      data: () => ({ lastInboundAt: { toMillis: () => recent } }),
    });
    await expect(isCommunityMessengerSessionExpired(contact)).resolves.toBe(false);
  });

  it("expires session after 24h idle", async () => {
    const stale = Date.now() - COMMUNITY_MESSENGER_INACTIVITY_RESET_MS - 1;
    mockGet.mockResolvedValueOnce({
      exists: true,
      data: () => ({ lastInboundAt: { toMillis: () => stale } }),
    });
    await expect(isCommunityMessengerSessionExpired(contact)).resolves.toBe(true);
  });

  it("records lastInboundAt on customer activity", async () => {
    await touchCommunityMessengerInboundActivity(contact);
    expect(mockSet).toHaveBeenCalledWith(
      expect.objectContaining({
        lastInboundAt: { __ts: true },
        metaPsid: "psid-123",
      }),
      { merge: true },
    );
  });
});
