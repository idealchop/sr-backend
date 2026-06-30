import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { processMetaCommunityWebhook } from "../../../../services/meta/meta-community-webhook-processor";
import * as intake from "../../../../services/meta/community-order-intake-service";
import * as wizard from "../../../../services/meta/community-order-wizard-service";
import * as sendService from "../../../../services/meta/meta-messenger-send-service";

describe("processMetaCommunityWebhook", () => {
  const sendSpy = vi.spyOn(sendService, "sendMetaMessengerText");
  const inboundSpy = vi.spyOn(intake, "handleCommunityInboundText");
  const locationSpy = vi.spyOn(intake, "handleCommunityInboundLocation");
  const welcomeSpy = vi.spyOn(wizard, "replyCommunityWelcomeWithChoice");

  beforeEach(() => {
    sendSpy.mockResolvedValue({ ok: true });
    inboundSpy.mockResolvedValue(undefined);
    locationSpy.mockResolvedValue(undefined);
    welcomeSpy.mockResolvedValue(undefined);
    process.env.META_COMMUNITY_PAGE_ID = "page-123";
  });

  afterEach(() => {
    sendSpy.mockReset();
    inboundSpy.mockReset();
    locationSpy.mockReset();
    welcomeSpy.mockReset();
    delete process.env.META_COMMUNITY_PAGE_ID;
  });

  it("delegates text to community intake handler", async () => {
    await processMetaCommunityWebhook({
      object: "page",
      entry: [
        {
          id: "page-123",
          messaging: [
            {
              sender: { id: "psid-1" },
              message: { mid: "m1", text: "name: Ana\ndelivery: no\nqty: 2\nnumber: 09171234567" },
            },
          ],
        },
      ],
    });

    expect(inboundSpy).toHaveBeenCalledOnce();
    expect(inboundSpy.mock.calls[0]?.[0]).toEqual({
      contact: {
        sourceChannel: "community_messenger",
        contactId: "psid-1",
      },
      text: "name: Ana\ndelivery: no\nqty: 2\nnumber: 09171234567",
      metaMessageId: "m1",
    });
  });

  it("sends welcome + form on GET_STARTED postback", async () => {
    await processMetaCommunityWebhook({
      object: "page",
      entry: [
        {
          id: "page-123",
          messaging: [
            {
              sender: { id: "psid-2" },
              postback: { payload: "GET_STARTED", title: "Get Started" },
            },
          ],
        },
      ],
    });

    expect(welcomeSpy).toHaveBeenCalledOnce();
    expect(welcomeSpy.mock.calls[0]?.[0]).toEqual({
      sourceChannel: "community_messenger",
      contactId: "psid-2",
    });
  });

  it("sends welcome + form on ORDER_START postback", async () => {
    await processMetaCommunityWebhook({
      object: "page",
      entry: [
        {
          id: "page-123",
          messaging: [
            {
              sender: { id: "psid-2b" },
              postback: { payload: "ORDER_START", title: "Order" },
            },
          ],
        },
      ],
    });

    expect(welcomeSpy).toHaveBeenCalledOnce();
    expect(welcomeSpy.mock.calls[0]?.[0]).toEqual({
      sourceChannel: "community_messenger",
      contactId: "psid-2b",
    });
  });

  it("delegates location attachment to location intake handler", async () => {
    await processMetaCommunityWebhook({
      object: "page",
      entry: [
        {
          id: "page-123",
          messaging: [
            {
              sender: { id: "psid-3" },
              message: {
                mid: "m-loc",
                attachments: [
                  {
                    type: "location",
                    payload: {
                      coordinates: { lat: 14.65, long: 121.03 },
                    },
                  },
                ],
              },
            },
          ],
        },
      ],
    });

    expect(locationSpy).toHaveBeenCalledOnce();
    expect(locationSpy.mock.calls[0]?.[0]).toEqual({
      contact: {
        sourceChannel: "community_messenger",
        contactId: "psid-3",
      },
      latitude: 14.65,
      longitude: 121.03,
      metaMessageId: "m-loc",
    });
    expect(inboundSpy).not.toHaveBeenCalled();
  });

  it("skips echo messages", async () => {
    await processMetaCommunityWebhook({
      object: "page",
      entry: [
        {
          id: "page-123",
          messaging: [
            {
              sender: { id: "psid-4" },
              message: { mid: "m2", text: "bot reply", is_echo: true },
            },
          ],
        },
      ],
    });

    expect(inboundSpy).not.toHaveBeenCalled();
  });

  it("handles WIZARD_START postback via wizard handler", async () => {
    const wizardPostbackSpy = vi.spyOn(wizard, "handleCommunityMessengerPostback");
    wizardPostbackSpy.mockResolvedValue(true);

    await processMetaCommunityWebhook({
      object: "page",
      entry: [
        {
          id: "page-123",
          messaging: [
            {
              sender: { id: "psid-wiz" },
              postback: { payload: "WIZARD_START", title: "Step-by-step" },
            },
          ],
        },
      ],
    });

    expect(wizardPostbackSpy).toHaveBeenCalledWith({
      contact: {
        sourceChannel: "community_messenger",
        contactId: "psid-wiz",
      },
      payload: "WIZARD_START",
      metaMessageId: undefined,
    });
    wizardPostbackSpy.mockRestore();
  });

  it("ignores non-page objects", async () => {
    await processMetaCommunityWebhook({ object: "instagram", entry: [] });
    expect(inboundSpy).not.toHaveBeenCalled();
  });
});
