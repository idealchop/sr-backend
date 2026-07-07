import { describe, expect, it } from "vitest";
import {
  customerUsesWrContainerRotation,
  getBusinessContainerDefaultPolicy,
  resolveContainerPolicy,
} from "../../../../services/customers/container-policy";

describe("container-policy", () => {
  it("defaults business policy to wrs_rotation", () => {
    expect(getBusinessContainerDefaultPolicy({})).toBe("wrs_rotation");
    expect(getBusinessContainerDefaultPolicy({ containerDefaultPolicy: "byog" })).toBe(
      "byog",
    );
  });

  it("resolves customer policy with inheritance", () => {
    expect(resolveContainerPolicy("unspecified", "byog")).toBe("byog");
    expect(resolveContainerPolicy(undefined, "wrs_rotation")).toBe("wrs_rotation");
  });

  it("skips WRS container sync for BYOG customers", () => {
    expect(
      customerUsesWrContainerRotation({ containerPolicy: "byog" }, "wrs_rotation"),
    ).toBe(false);
    expect(
      customerUsesWrContainerRotation({ containerPolicy: "unspecified" }, "wrs_rotation"),
    ).toBe(true);
  });
});
