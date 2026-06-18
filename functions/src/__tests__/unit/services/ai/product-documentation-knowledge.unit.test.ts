import { describe, expect, it } from "vitest";
import {
  SUPPORT_PRODUCT_DOC_ENTRIES,
  SUPPORT_PRODUCT_DOCUMENTATION,
} from "../../../../services/ai/product-documentation-knowledge";

describe("product-documentation-knowledge", () => {
  it("documents Google sign-in in-app browser limitation for River AI support", () => {
    expect(SUPPORT_PRODUCT_DOCUMENTATION).toMatch(/Google/i);
    expect(SUPPORT_PRODUCT_DOCUMENTATION).toMatch(/in-app browser|Messenger|Safari/i);

    const entry = SUPPORT_PRODUCT_DOC_ENTRIES.find(
      (row) => row.id === "doc-google-in-app-browser",
    );
    expect(entry).toBeDefined();
    expect(entry?.content).toMatch(/Facebook|Messenger|Instagram/i);
    expect(entry?.content).toMatch(/Safari|Chrome/i);
  });

  it("documents River AI vs profile Chat support entry points", () => {
    expect(SUPPORT_PRODUCT_DOCUMENTATION).toMatch(/Header River AI/i);
    expect(SUPPORT_PRODUCT_DOCUMENTATION).toMatch(/Chat support/i);

    const entry = SUPPORT_PRODUCT_DOC_ENTRIES.find(
      (row) => row.id === "doc-river-ai-vs-live-support",
    );
    expect(entry).toBeDefined();
    expect(entry?.content).toMatch(/Profile menu/i);
  });
});
