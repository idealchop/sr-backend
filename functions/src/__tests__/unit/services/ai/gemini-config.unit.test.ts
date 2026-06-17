import { afterEach, describe, expect, it } from "vitest";
import {
  DEFAULT_GEMINI_MODEL,
  GEMINI_MODEL_LADDER,
  LATEST_GEMINI_MODEL,
  getGeminiApiKey,
  getGeminiModel,
} from "../../../../services/ai/gemini-config";

describe("gemini-config", () => {
  const env = { ...process.env };

  afterEach(() => {
    process.env = { ...env };
  });

  it("defaults to one stable release behind the latest GA Flash model", () => {
    expect(LATEST_GEMINI_MODEL).toBe(GEMINI_MODEL_LADDER[0]);
    expect(DEFAULT_GEMINI_MODEL).toBe(GEMINI_MODEL_LADDER[1]);
    expect(getGeminiModel()).toBe(DEFAULT_GEMINI_MODEL);
  });

  it("reads GEMINI_MODEL and SMARTREFILL_GEMINI_API_KEY from env", () => {
    process.env.GEMINI_MODEL = "gemini-2.5-flash";
    process.env.SMARTREFILL_GEMINI_API_KEY = " test-key ";
    expect(getGeminiModel()).toBe("gemini-2.5-flash");
    expect(getGeminiApiKey()).toBe("test-key");
  });

  it("prefers GEMINI_API_KEY over SMARTREFILL_GEMINI_API_KEY", () => {
    process.env.GEMINI_API_KEY = "primary-key";
    process.env.SMARTREFILL_GEMINI_API_KEY = "fallback-key";
    expect(getGeminiApiKey()).toBe("primary-key");
  });
});
