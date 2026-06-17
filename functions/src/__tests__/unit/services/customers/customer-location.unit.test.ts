import { describe, expect, it, vi } from "vitest";

vi.mock("../../../../config/firebase-admin", () => ({
  FieldValue: {
    delete: vi.fn(() => "__DELETE__"),
  },
}));

import {
  applyCustomerLocationPatch,
  resolveCustomerLocationForWrite,
} from "../../../../services/customers/customer-location";

describe("customer-location", () => {
  it("omits coordinates when address is blank", () => {
    expect(
      resolveCustomerLocationForWrite({
        address: "",
        latitude: 14.5,
        longitude: 121,
      }),
    ).toEqual({ address: "" });
  });

  it("omits coordinates when only lat/lng are sent without address", () => {
    expect(
      resolveCustomerLocationForWrite({
        latitude: 14.5,
        longitude: 121,
      }),
    ).toEqual({ address: "" });
  });

  it("persists coordinates when address and valid lat/lng are present", () => {
    expect(
      resolveCustomerLocationForWrite({
        address: "404 EL GRANDE",
        latitude: 14.45,
        longitude: 121.02,
      }),
    ).toEqual({
      address: "404 EL GRANDE",
      latitude: 14.45,
      longitude: 121.02,
    });
  });

  it("deletes stored coordinates on update when address is cleared", () => {
    const patch = applyCustomerLocationPatch({
      address: "",
      latitude: 14.45,
      longitude: 121.02,
    });

    expect(patch.address).toBe("");
    expect(patch.latitude).toBe("__DELETE__");
    expect(patch.longitude).toBe("__DELETE__");
  });
});
