import { describe, it, expect, afterEach } from "vitest";
import type { Request } from "express";
import {
  buildPortalDeepLink,
  buildQrImageUrl,
  getApiPublicBase,
  getPortalAppBase,
} from "../../../../services/customers/qr-customer-service";

function makeReq(headers: Record<string, string | undefined>): Request {
  return {
    protocol: "https",
    get: (name: string) => headers[name.toLowerCase()],
  } as Request;
}

describe("qr-customer-service URL helpers", () => {
  const prevApi = process.env.API_PUBLIC_BASE_URL;
  const prevPortal = process.env.PORTAL_APP_BASE_URL;

  afterEach(() => {
    if (prevApi === undefined) delete process.env.API_PUBLIC_BASE_URL;
    else process.env.API_PUBLIC_BASE_URL = prevApi;
    if (prevPortal === undefined) delete process.env.PORTAL_APP_BASE_URL;
    else process.env.PORTAL_APP_BASE_URL = prevPortal;
  });

  it("getApiPublicBase prefers API_PUBLIC_BASE_URL", () => {
    process.env.API_PUBLIC_BASE_URL = "https://api.example.com/";
    const req = makeReq({ host: "ignored:8080" });
    expect(getApiPublicBase(req)).toBe("https://api.example.com");
  });

  it("getApiPublicBase falls back to forwarded host and proto", () => {
    delete process.env.API_PUBLIC_BASE_URL;
    const req = makeReq({
      "x-forwarded-host": "bff.run.app",
      "x-forwarded-proto": "https",
    });
    expect(getApiPublicBase(req)).toBe("https://bff.run.app");
  });

  it("buildPortalDeepLink uses PORTAL_APP_BASE_URL", () => {
    process.env.PORTAL_APP_BASE_URL = "https://app.example.com";
    const link = buildPortalDeepLink("biz1", "cust1", "tok123");
    expect(link).toBe("https://app.example.com/order?b=biz1&c=cust1&t=tok123");
  });

  it("getPortalAppBase strips trailing slash", () => {
    process.env.PORTAL_APP_BASE_URL = "http://localhost:3000/";
    expect(getPortalAppBase()).toBe("http://localhost:3000");
  });

  it("buildQrImageUrl encodes query params", () => {
    process.env.API_PUBLIC_BASE_URL = "https://api.example.com";
    const req = makeReq({});
    const url = buildQrImageUrl(req, "b", "c", "t");
    expect(url).toContain("/public/qr.png?");
    expect(url).toContain("b=b");
    expect(url).toContain("c=c");
    expect(url).toContain("t=t");
  });
});
