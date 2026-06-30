import { describe, expect, it } from "vitest";
import { normalizeCommunityDispatchSlug } from "../../../../services/meta/community-dispatch-settings-service";

describe("community-dispatch-settings-service", () => {
  it("normalizes valid slugs", () => {
    expect(normalizeCommunityDispatchSlug("Water-Ko-To")).toBe("water-ko-to");
    expect(normalizeCommunityDispatchSlug("  aqua flow qc  ")).toBe("aqua-flow-qc");
  });

  it("rejects invalid slugs", () => {
    expect(normalizeCommunityDispatchSlug("ab")).toBeNull();
    expect(normalizeCommunityDispatchSlug("bad_slug")).toBeNull();
    expect(normalizeCommunityDispatchSlug("")).toBeNull();
  });
});
