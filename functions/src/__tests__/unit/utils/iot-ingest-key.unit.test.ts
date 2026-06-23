import { describe, expect, it } from "vitest";
import {
  generateIotIngestKey,
  hashIotIngestKey,
  iotIngestKeyHint,
  verifyIotIngestKey,
} from "../../../utils/iot-ingest-key";

describe("iot-ingest-key", () => {
  it("generates keys with sr_iot prefix", () => {
    const key = generateIotIngestKey();
    expect(key.startsWith("sr_iot_")).toBe(true);
    expect(key.length).toBeGreaterThan(20);
  });

  it("hashes and verifies ingest keys", () => {
    const key = generateIotIngestKey();
    const hash = hashIotIngestKey(key);
    expect(verifyIotIngestKey(key, hash)).toBe(true);
    expect(verifyIotIngestKey("wrong-key", hash)).toBe(false);
  });

  it("builds a short hint from key suffix", () => {
    expect(iotIngestKeyHint("sr_iot_abc123xyz9")).toBe("…xyz9");
  });
});
