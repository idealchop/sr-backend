import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { sendMetaMessengerText } from "../../../../services/meta/meta-messenger-send-service";

vi.mock("../../../../services/meta/meta-secret-resolver", () => ({
  fetchMetaSecretFromManager: vi.fn(async () => null),
}));

describe("meta-messenger-send-service", () => {
  const fetchMock = vi.fn();

  beforeEach(() => {
    vi.stubGlobal("fetch", fetchMock);
    process.env.META_COMMUNITY_PAGE_ACCESS_TOKEN = "test-page-token";
    fetchMock.mockResolvedValue({
      ok: true,
      json: async () => ({ message_id: "mid-1" }),
    });
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    delete process.env.META_COMMUNITY_PAGE_ACCESS_TOKEN;
    delete process.env.META_COMMUNITY_PAGE_ID;
  });

  it("sends messaging_type RESPONSE for proactive customer updates", async () => {
    process.env.META_COMMUNITY_PAGE_ID = "page-999";
    const result = await sendMetaMessengerText("psid-123", "Station accepted your order");

    expect(result.ok).toBe(true);
    expect(fetchMock).toHaveBeenCalledTimes(1);

    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toContain("/page-999/messages");
    const body = JSON.parse(String(init.body)) as {
      messaging_type?: string;
      recipient?: { id?: string };
      message?: { text?: string };
    };

    expect(body.messaging_type).toBe("RESPONSE");
    expect(body.recipient?.id).toBe("psid-123");
    expect(body.message?.text).toContain("Station accepted your order");
  });
});
