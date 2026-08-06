import { afterEach, describe, expect, it, vi } from "vitest";
import {
  parseCommunityFreeTextOrder,
  parseCommunityFreeTextOrderLocal,
  resetCommunityNluRateLimitForTests,
} from "../../../../services/meta/community-order-nlu-service";

vi.mock("../../../../services/ai/gemini-config", () => ({
  getGeminiApiKey: () => "test-key",
}));

const geminiGenerateJson = vi.fn();
vi.mock("../../../../services/ai/gemini-client", () => ({
  geminiGenerateJson: (...args: unknown[]) => geminiGenerateJson(...args),
}));

describe("parseCommunityFreeTextOrderLocal", () => {
  it("extracts common Taglish order fields without Gemini", () => {
    const result = parseCommunityFreeTextOrderLocal(
      "Ako si Juan dela Cruz, 5 galon alkaline delivery sa Brgy San Jose, 09171234567",
    );
    expect(result.source).toBe("local");
    expect(result.fields.name).toMatch(/Juan/i);
    expect(result.fields.qty).toBe(5);
    expect(result.fields.delivery).toBe(true);
    expect(result.fields.number).toMatch(/0917/);
    expect(result.fields.preferredWaterType?.toLowerCase()).toContain("alkaline");
    expect(result.fields.location).toBeTruthy();
    expect(result.confidence).toBeGreaterThanOrEqual(0.65);
  });

  it("returns low confidence for sparse messages", () => {
    const result = parseCommunityFreeTextOrderLocal("hello");
    expect(result.source).toBe("local");
    expect(result.confidence).toBeLessThan(0.65);
  });
});

describe("parseCommunityFreeTextOrder rate limit", () => {
  afterEach(() => {
    resetCommunityNluRateLimitForTests();
    geminiGenerateJson.mockReset();
  });

  it("skips Gemini when local parse is sufficient", async () => {
    const result = await parseCommunityFreeTextOrder(
      "Ako si Maria Santos, 3 galon pickup, 09181234567",
      { psid: "psid-local" },
    );
    expect(result.source).toBe("local");
    expect(result.fields.name).toMatch(/Maria/i);
    expect(result.fields.delivery).toBe(false);
    expect(geminiGenerateJson).not.toHaveBeenCalled();
  });

  it("returns rate_limited after 8 Gemini attempts per PSID", async () => {
    geminiGenerateJson.mockResolvedValue({
      name: "X",
      delivery: true,
      qty: 2,
      number: "09171111111",
      confidence: 0.9,
    });

    const sparse = "order please";
    for (let i = 0; i < 8; i++) {
      const r = await parseCommunityFreeTextOrder(sparse, { psid: "psid-cap" });
      expect(r.source).toBe("ai");
    }

    const limited = await parseCommunityFreeTextOrder(sparse, {
      psid: "psid-cap",
    });
    expect(limited.source).toBe("rate_limited");
    expect(geminiGenerateJson).toHaveBeenCalledTimes(8);
  });
});
