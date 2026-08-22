import { describe, expect, it } from "vitest";
import {
  mergeProductIcons,
  SEEDED_PRODUCT_ICONS,
} from "../../../../services/products/product-icon-catalog";

describe("mergeProductIcons", () => {
  it("uses seeded gallon images when Sales Portal CMS is empty", () => {
    const icons = mergeProductIcons([]);
    expect(icons.map((icon) => icon.id)).toEqual(["round-gallon", "slim-gallon"]);
    expect(icons.every((icon) => icon.imageUrl)).toBe(true);
    expect(icons.some((icon) => icon.lucide)).toBe(false);
  });

  it("uses only Sales Portal image icons when CMS is populated", () => {
    const icons = mergeProductIcons([
      {
        id: "Round Gallon",
        name: "Round Gallon",
        imageUrl: "https://example.com/round.svg",
        sortOrder: 1,
        active: true,
      },
      {
        id: "Slim Gallon",
        name: "Slim Gallon",
        imageUrl: "https://example.com/slim.svg",
        sortOrder: 2,
        active: true,
      },
      {
        id: "droplets",
        name: "Water",
        lucide: "Droplets",
        sortOrder: 0,
        active: true,
      },
    ]);
    expect(icons.map((icon) => icon.id)).toEqual(["Round Gallon", "Slim Gallon"]);
    expect(icons.some((icon) => icon.id === "droplets")).toBe(false);
    expect(icons.some((icon) => icon.id === "round-gallon")).toBe(false);
  });

  it("ignores lucide-only CMS rows so placeholders stay out of the picker", () => {
    const icons = mergeProductIcons([
      {
        id: "package",
        name: "Package",
        lucide: "Package",
        sortOrder: 3,
        active: true,
      },
    ]);
    expect(icons.map((icon) => icon.id)).toEqual(
      SEEDED_PRODUCT_ICONS.map((icon) => icon.id),
    );
  });
});
