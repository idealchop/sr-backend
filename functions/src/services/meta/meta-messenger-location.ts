export type MessengerLocationPin = {
  latitude: number;
  longitude: number;
};

type MessengerAttachment = {
  type?: string;
  payload?: {
    coordinates?: {
      lat?: number;
      long?: number;
      lng?: number;
    };
  };
};

/** Parse a Meta Messenger location attachment (user shared pin / current location). */
export function parseMessengerLocationAttachment(
  message?: { attachments?: unknown[] },
): MessengerLocationPin | null {
  if (!message || !Array.isArray(message.attachments)) return null;

  for (const raw of message.attachments) {
    const attachment = raw as MessengerAttachment;
    if (attachment.type !== "location") continue;

    const lat = attachment.payload?.coordinates?.lat;
    const lng =
      attachment.payload?.coordinates?.long ??
      attachment.payload?.coordinates?.lng;

    if (
      typeof lat !== "number" ||
      typeof lng !== "number" ||
      !Number.isFinite(lat) ||
      !Number.isFinite(lng)
    ) {
      continue;
    }

    if (lat === 0 && lng === 0) continue;
    return { latitude: lat, longitude: lng };
  }

  return null;
}

export function buildMessengerPinLocationLabel(
  latitude: number,
  longitude: number,
): string {
  return `Messenger location pin (${latitude.toFixed(5)}, ${longitude.toFixed(5)})`;
}
