import { describe, expect, it, vi, beforeEach } from "vitest";
import { readCommunityCustomerContact } from "../../../../services/meta/community-channel-contact";

describe("community channel contact", () => {
  it("reads messenger contact from legacy metaPsid", () => {
    expect(
      readCommunityCustomerContact({
        sourceChannel: "community_messenger",
        metaPsid: "psid-1",
      }),
    ).toEqual({
      sourceChannel: "community_messenger",
      contactId: "psid-1",
    });
  });

  it("reads whatsapp contact for CP-30", () => {
    expect(
      readCommunityCustomerContact({
        sourceChannel: "community_whatsapp",
        whatsappWaId: "639171234567",
        channelContactId: "639171234567",
      }),
    ).toEqual({
      sourceChannel: "community_whatsapp",
      contactId: "639171234567",
    });
  });

  it("reads viber contact for CP-31", () => {
    expect(
      readCommunityCustomerContact({
        sourceChannel: "community_viber",
        viberUserId: "viber-user-abc",
        channelContactId: "viber-user-abc",
      }),
    ).toEqual({
      sourceChannel: "community_viber",
      contactId: "viber-user-abc",
    });
  });
});
