import { describe, expect, it } from "vitest";
import {
  customerUsesWrContainerRotation,
  getBusinessContainerDefaultPolicy,
  resolveContainerPolicy,
} from "../../../../services/customers/container-policy";

describe("container-policy", () => {
  it("defaults business policy to byog (own gallon)", () => {
    expect(getBusinessContainerDefaultPolicy({})).toBe("byog");
    expect(getBusinessContainerDefaultPolicy({ containerDefaultPolicy: "byog" })).toBe(
      "byog",
    );
    expect(
      getBusinessContainerDefaultPolicy({ containerDefaultPolicy: "wrs_rotation" }),
    ).toBe("wrs_rotation");
  });

  it("resolves customer policy with inheritance", () => {
    expect(resolveContainerPolicy("unspecified", "byog")).toBe("byog");
    expect(resolveContainerPolicy(undefined, undefined)).toBe("byog");
    expect(resolveContainerPolicy(undefined, "wrs_rotation")).toBe("wrs_rotation");
  });

  it("skips WRS container sync for BYOG customers", () => {
    expect(
      customerUsesWrContainerRotation({ containerPolicy: "byog" }, "wrs_rotation"),
    ).toBe(false);
    expect(
      customerUsesWrContainerRotation({ containerPolicy: "unspecified" }, "wrs_rotation"),
    ).toBe(true);
    expect(
      customerUsesWrContainerRotation({ containerPolicy: "unspecified" }, undefined),
    ).toBe(false);
  });
});
