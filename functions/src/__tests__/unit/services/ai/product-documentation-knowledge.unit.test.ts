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

  it("documents Team Hub record-only personnel for River AI support", () => {
    expect(SUPPORT_PRODUCT_DOCUMENTATION).toMatch(/record-only|Access credential not needed/i);

    const entry = SUPPORT_PRODUCT_DOC_ENTRIES.find(
      (row) => row.id === "doc-team-hub-record-only",
    );
    expect(entry).toBeDefined();
    expect(entry?.content).toMatch(/Access credential not needed/i);
    expect(entry?.content).toMatch(/My Area|live GPS/i);
  });

  it("documents Operations hub KPIs and projected profit", () => {
    expect(SUPPORT_PRODUCT_DOCUMENTATION).toMatch(/Daily averages row/i);
    expect(SUPPORT_PRODUCT_DOCUMENTATION).toMatch(/projected month-end profit/i);
    expect(SUPPORT_PRODUCT_DOCUMENTATION).toMatch(/River AI observes/i);
    expect(SUPPORT_PRODUCT_DOCUMENTATION).toMatch(/community order/i);

    const entry = SUPPORT_PRODUCT_DOC_ENTRIES.find(
      (row) => row.id === "doc-ops-hub-kpis",
    );
    expect(entry).toBeDefined();
    expect(entry?.content).toMatch(/Daily averages|projected/i);
  });

  it("documents portal track behavior for record-only riders", () => {
    expect(SUPPORT_PRODUCT_DOCUMENTATION).toMatch(/En route/i);

    const entry = SUPPORT_PRODUCT_DOC_ENTRIES.find(
      (row) => row.id === "doc-portal-track-record-only",
    );
    expect(entry).toBeDefined();
    expect(entry?.content).toMatch(/record-only rider/i);
    expect(entry?.content).toMatch(/En route|live GPS map/i);
  });

  it("documents walk-in paid-only stock and ledger subtype labels", () => {
    expect(SUPPORT_PRODUCT_DOCUMENTATION).toMatch(/Walk-in sales/i);
    expect(SUPPORT_PRODUCT_DOCUMENTATION).toMatch(/only when paid/i);
    expect(SUPPORT_PRODUCT_DOCUMENTATION).toMatch(/Ledger subtype labels/i);
  });
});
