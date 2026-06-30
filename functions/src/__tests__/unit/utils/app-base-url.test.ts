import { describe, expect, it } from "vitest";
import {
  parseAppBaseUrlFromBody,
  resolveAppBaseUrlForEmail,
} from "../../../utils/app-base-url";

describe("app-base-url", () => {
  it("prefers appBaseUrl over legacy baseUrl", () => {
    expect(
      parseAppBaseUrlFromBody({
        appBaseUrl: "https://dev.smartrefill.io",
        baseUrl: "https://smartrefill.io",
      }),
    ).toBe("https://dev.smartrefill.io");
  });

  it("falls back to baseUrl when appBaseUrl is empty", () => {
    expect(
      parseAppBaseUrlFromBody({ appBaseUrl: "  ", baseUrl: "https://staging.example.com" }),
    ).toBe("https://staging.example.com");
  });

  it("resolveAppBaseUrlForEmail uses caller override", () => {
    expect(resolveAppBaseUrlForEmail("https://preview.example.com/")).toBe(
      "https://preview.example.com",
    );
  });

  it("resolveAppBaseUrlForEmail defaults to app.smartrefill.io in production mode", () => {
    expect(resolveAppBaseUrlForEmail()).toBe("https://app.smartrefill.io");
  });
});
