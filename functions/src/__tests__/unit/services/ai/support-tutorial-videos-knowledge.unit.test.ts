import { describe, expect, it } from "vitest";
import {
  formatTutorialVideosCatalogBlock,
  mapPublishedTutorialForTest,
  tutorialVideosToKnowledgeEntries,
} from "../../../../services/ai/support-tutorial-videos-knowledge";
import { buildSupportKnowledgeContext } from "../../../../services/ai/support-knowledge-catalog";

describe("support-tutorial-videos-knowledge", () => {
  it("maps published SmartRefill tutorial docs", () => {
    const mapped = mapPublishedTutorialForTest("vid-1", {
      category: "tutorial",
      status: "published",
      appId: "smartrefill",
      name: "How to add a delivery",
      description: "Follow along while recording a delivery.",
      appPages: ["transactions"],
    });
    expect(mapped).toEqual({
      id: "vid-1",
      name: "How to add a delivery",
      description: "Follow along while recording a delivery.",
      appPages: ["transactions"],
    });
  });

  it("skips drafts and non-tutorial categories", () => {
    expect(
      mapPublishedTutorialForTest("a", {
        category: "webinar",
        status: "published",
        name: "Webinar",
      }),
    ).toBeNull();
    expect(
      mapPublishedTutorialForTest("b", {
        category: "tutorial",
        status: "draft",
        name: "Draft",
      }),
    ).toBeNull();
  });

  it("builds knowledge entries and catalog with deep links", () => {
    const videos = [
      {
        id: "vid-1",
        name: "How to add a delivery",
        description: "Record a delivery step by step.",
        appPages: ["transactions"],
      },
    ];
    const entries = tutorialVideosToKnowledgeEntries(videos);
    expect(entries[0]?.topic).toContain("How to add a delivery");
    expect(entries[0]?.content).toContain("/dashboard?tutorial=vid-1");

    const block = formatTutorialVideosCatalogBlock(videos);
    expect(block).toContain("How to add a delivery");
    expect(block).toContain("Tutorial videos");
    expect(block).toContain("`vid-1`");
  });

  it("includes static tutorial FAQ in support knowledge context", () => {
    const ctx = buildSupportKnowledgeContext([], "video tutorial how to");
    expect(ctx.toLowerCase()).toContain("tutorial");
    expect(ctx).toContain("Tutorial videos");
  });
});
