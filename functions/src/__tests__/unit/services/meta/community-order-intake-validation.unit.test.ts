import { describe, expect, it, vi, beforeEach } from "vitest";

vi.mock("../../../../services/maps/geocoding-service", () => ({
  GeocodingService: {
    geocodeAddress: vi.fn(),
  },
}));

import { GeocodingService } from "../../../../services/maps/geocoding-service";
import {
  applyCommunityOrderTextPatch,
  hasValidCommunityOrderLines,
  validateCommunityOrderIntakeQuality,
} from "../../../../services/meta/community-order-intake-validation";
import { parseCommunityOrderTemplate } from "../../../../services/meta/community-dispatch-template-parser";
import {
  buildCommunityAddressRepairMessage,
  buildCommunityOrderFormatRepairMessage,
} from "../../../../services/meta/community-order-reply-service";

describe("community-order-intake-validation", () => {
  beforeEach(() => {
    vi.mocked(GeocodingService.geocodeAddress).mockReset();
  });

  it("accepts minimal form with name, address, and order only", () => {
    const result = parseCommunityOrderTemplate(`Name: Ana Cruz
Address: 12 Jasmine St, Brgy. San Roque, Antipolo City
Order: 2 slim - alkaline`);

    expect(result.ok).toBe(true);
    expect(result.fields.email).toBeUndefined();
    expect(result.fields.number).toBeUndefined();
  });

  it("treats none and n/a as empty email and number", () => {
    const result = parseCommunityOrderTemplate(`Name: Ana Cruz
Address: 12 Jasmine St, Brgy. San Roque, Antipolo City
Email: none
Number: N/A
Order: 1 round - purified`);

    expect(result.ok).toBe(true);
    expect(result.fields.email).toBeUndefined();
    expect(result.fields.number).toBeUndefined();
  });

  it("prioritizes address issue before order issue", async () => {
    vi.mocked(GeocodingService.geocodeAddress).mockResolvedValue(null);

    const quality = await validateCommunityOrderIntakeQuality({
      name: "Ana",
      delivery: true,
      location: "somewhere vague",
      orderRaw: "bad order text",
    });

    expect(quality.ok).toBe(false);
    expect(quality.issue).toBe("address");
  });

  it("returns order issue when address geocodes but order is unreadable", async () => {
    vi.mocked(GeocodingService.geocodeAddress).mockResolvedValue({
      latitude: 14.6,
      longitude: 121.1,
      formattedAddress: "Antipolo City, Philippines",
    });

    const quality = await validateCommunityOrderIntakeQuality({
      name: "Ana",
      delivery: true,
      location: "12 Jasmine St, Antipolo City",
      orderRaw: "five jugs please",
    });

    expect(quality.ok).toBe(false);
    expect(quality.issue).toBe("order");
    expect(quality.geocode?.formattedAddress).toContain("Antipolo");
  });

  it("passes when address geocodes and order lines parse", async () => {
    vi.mocked(GeocodingService.geocodeAddress).mockResolvedValue({
      latitude: 14.6,
      longitude: 121.1,
      formattedAddress: "Antipolo City, Philippines",
    });

    const fields = parseCommunityOrderTemplate(`Name: Ana
Address: 12 Jasmine St, Antipolo City
Order: 3 slim - alkaline, 4 round - purified`).fields;

    const quality = await validateCommunityOrderIntakeQuality(fields);
    expect(quality.ok).toBe(true);
    expect(hasValidCommunityOrderLines(fields)).toBe(true);
  });

  it("applyCommunityOrderTextPatch parses plain-text order follow-up", () => {
    const patched = applyCommunityOrderTextPatch(
      { name: "Ana", location: "Antipolo" },
      "2 round - mineral",
    );

    expect(patched.orderLines).toEqual([
      { qty: 2, container: "round", waterType: "mineral" },
    ]);
  });
});

describe("community-order repair messages", () => {
  it("builds address repair with Google Maps tip", () => {
    const msg = buildCommunityAddressRepairMessage("bad addr");
    expect(msg).toContain("Google Maps");
    expect(msg).toContain("bad addr");
    expect(msg).toContain("location pin");
  });

  it("builds order format repair with container and water reminders", () => {
    const msg = buildCommunityOrderFormatRepairMessage("5 jugs");
    expect(msg).toContain("slim o round");
    expect(msg).toContain("alkaline, mineral, o purified");
    expect(msg).toContain("3 slim - alkaline");
    expect(msg).toContain("5 jugs");
  });
});
