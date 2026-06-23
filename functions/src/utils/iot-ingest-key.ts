import { createHash, randomBytes } from "crypto";

const KEY_PREFIX = "sr_iot_";

export function generateIotIngestKey(): string {
  return `${KEY_PREFIX}${randomBytes(24).toString("base64url")}`;
}

export function hashIotIngestKey(key: string): string {
  return createHash("sha256").update(String(key).trim()).digest("hex");
}

export function iotIngestKeyHint(key: string): string {
  const trimmed = String(key).trim();
  if (trimmed.length <= 8) return "****";
  return `…${trimmed.slice(-4)}`;
}

export function verifyIotIngestKey(provided: string, storedHash: string): boolean {
  const hash = hashIotIngestKey(provided);
  const expected = String(storedHash || "").trim();
  if (!hash || !expected) return false;
  return hash === expected;
}
