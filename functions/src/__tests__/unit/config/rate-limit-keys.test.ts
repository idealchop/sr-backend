import { describe, it, expect } from "vitest";
import type { Request } from "express";
import { rateLimitKeyForRequest } from "../../../config/rate-limit-keys";

function mockReq(partial: Partial<Request>): Request {
  return partial as Request;
}

describe("rateLimitKeyForRequest", () => {
  it("uses auth bucket for Bearer tokens", () => {
    const req = mockReq({
      headers: { authorization: "Bearer token-a" },
      ip: "1.2.3.4",
    });
    const keyA = rateLimitKeyForRequest(req);
    const keyB = rateLimitKeyForRequest(
      mockReq({ headers: { authorization: "Bearer token-b" }, ip: "1.2.3.4" }),
    );
    expect(keyA).toMatch(/^auth:/);
    expect(keyA).not.toBe(keyB);
  });

  it("falls back to IP when unauthenticated", () => {
    const req = mockReq({ ip: "10.0.0.1", headers: {} });
    expect(rateLimitKeyForRequest(req)).toBe("ip:10.0.0.1");
  });
});
