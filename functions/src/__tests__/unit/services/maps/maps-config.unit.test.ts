import { describe, expect, it, afterEach } from "vitest";
import {
  GOOGLE_MAPS_SECRET_ID,
  GOOGLE_MAPS_SERVER_SECRET_ID,
  getGoogleMapsApiKey,
} from "../../../../services/maps/maps-config";

describe("getGoogleMapsApiKey", () => {
  const saved: Record<string, string | undefined> = {};

  afterEach(() => {
    for (const [key, value] of Object.entries(saved)) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  });

  function setEnv(key: string, value: string | undefined) {
    if (!(key in saved)) saved[key] = process.env[key];
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }

  it("prefers the server Secret Manager id", () => {
    setEnv(GOOGLE_MAPS_SERVER_SECRET_ID, " server-key ");
    setEnv(GOOGLE_MAPS_SECRET_ID, " browser-key ");
    setEnv("GOOGLE_MAPS_API_KEY", "local-key");
    expect(getGoogleMapsApiKey()).toBe("server-key");
  });

  it("falls back to browser secret when server secret unset", () => {
    setEnv(GOOGLE_MAPS_SERVER_SECRET_ID, undefined);
    setEnv(GOOGLE_MAPS_SECRET_ID, " secret-from-sm ");
    setEnv("GOOGLE_MAPS_API_KEY", "local-key");
    expect(getGoogleMapsApiKey()).toBe("secret-from-sm");
  });

  it("falls back to GOOGLE_MAPS_API_KEY for local .env", () => {
    setEnv(GOOGLE_MAPS_SERVER_SECRET_ID, undefined);
    setEnv(GOOGLE_MAPS_SECRET_ID, undefined);
    setEnv("GOOGLE_MAPS_API_KEY", " local-key ");
    expect(getGoogleMapsApiKey()).toBe("local-key");
  });
});
