import { createHash } from "crypto";
import type { Request } from "express";

/**
 * Per-user buckets for authenticated traffic (Bearer token hash),
 * per-IP for public/unauthenticated calls.
 * @param {Request} req Express request.
 * @return {string} Rate-limit key.
 */
export function rateLimitKeyForRequest(req: Request): string {
  const bearer = req.headers.authorization;
  if (typeof bearer === "string" && bearer.startsWith("Bearer ")) {
    const hash = createHash("sha256").update(bearer).digest("hex").slice(0, 24);
    return `auth:${hash}`;
  }
  const ip = req.ip || req.socket?.remoteAddress || "unknown";
  return `ip:${ip}`;
}
