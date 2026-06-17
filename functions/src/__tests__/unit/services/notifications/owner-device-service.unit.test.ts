import { describe, expect, it } from "vitest";
import { createHash } from "node:crypto";

function tokenDocId(token: string): string {
  return createHash("sha256").update(token).digest("hex").slice(0, 40);
}

describe("owner device token doc id", () => {
  it("is stable for the same token", () => {
    const id1 = tokenDocId("abc-token");
    const id2 = tokenDocId("abc-token");
    expect(id1).toBe(id2);
    expect(id1).toHaveLength(40);
  });

  it("differs for different tokens", () => {
    expect(tokenDocId("one")).not.toBe(tokenDocId("two"));
  });
});
