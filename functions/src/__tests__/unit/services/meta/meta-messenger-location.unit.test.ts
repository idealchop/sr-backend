import { describe, expect, it } from "vitest";
import {
  buildMessengerPinLocationLabel,
  parseMessengerLocationAttachment,
} from "../../../../services/meta/meta-messenger-location";

describe("meta-messenger-location", () => {
  it("parses Meta location attachment coordinates", () => {
    const pin = parseMessengerLocationAttachment({
      attachments: [
        {
          type: "location",
          payload: {
            coordinates: { lat: 14.676, long: 121.0437 },
          },
        },
      ],
    });

    expect(pin).toEqual({ latitude: 14.676, longitude: 121.0437 });
  });

  it("accepts lng alias for longitude", () => {
    const pin = parseMessengerLocationAttachment({
      attachments: [
        {
          type: "location",
          payload: {
            coordinates: { lat: 14.1, lng: 121.2 },
          },
        },
      ],
    });

    expect(pin).toEqual({ latitude: 14.1, longitude: 121.2 });
  });

  it("ignores non-location attachments and invalid coords", () => {
    expect(
      parseMessengerLocationAttachment({
        attachments: [{ type: "image", payload: {} }],
      }),
    ).toBeNull();

    expect(
      parseMessengerLocationAttachment({
        attachments: [
          {
            type: "location",
            payload: { coordinates: { lat: 0, long: 0 } },
          },
        ],
      }),
    ).toBeNull();
  });

  it("builds fallback pin label", () => {
    expect(buildMessengerPinLocationLabel(14.676, 121.0437)).toBe(
      "Messenger location pin (14.67600, 121.04370)",
    );
  });
});
