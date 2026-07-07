import { describe, expect, it } from "vitest";
import {
  formatCommunityOrderLines,
  parseCommunityOrderLines,
  parseCommunityOrderTemplate,
  validateCommunityOrderFields,
} from "../../../../services/meta/community-dispatch-template-parser";

describe("community-dispatch-template-parser", () => {
  it("parses revised order form with multi-item order lines", () => {
    const text = `Name: John Doe
Address: 12 Jasmine St, Brgy. San Roque, Antipolo City
Email:
Number:
Order: 3 slim - alkaline, 4 round - purified`;

    const result = parseCommunityOrderTemplate(text);
    expect(result.ok).toBe(true);
    expect(result.errors).toEqual([]);
    expect(result.fields.name).toBe("John Doe");
    expect(result.fields.delivery).toBe(true);
    expect(result.fields.location).toBe("12 Jasmine St, Brgy. San Roque, Antipolo City");
    expect(result.fields.qty).toBe(7);
    expect(result.fields.orderLines).toEqual([
      { qty: 3, container: "slim", waterType: "alkaline" },
      { qty: 4, container: "round", waterType: "purified" },
    ]);
    expect(result.fields.preferredWaterType).toBe("3 slim - alkaline, 4 round - purified");
    expect(result.looksLikeTemplate).toBe(true);
  });

  it("parses legacy delivery-first template without delivery line", () => {
    const text = `name: Justfer (Testing)
qty: 10
preferred water type: alkaline
location: Alabang, Muntinlupa City
email: justfer15@gmail.com
number: 09773907598`;

    const result = parseCommunityOrderTemplate(text);
    expect(result.ok).toBe(true);
    expect(result.fields.delivery).toBe(true);
    expect(result.fields.qty).toBe(10);
    expect(result.fields.location).toBe("Alabang, Muntinlupa City");
  });

  it("parses a complete legacy template", () => {
    const text = `name: Maria Santos
delivery: yes
qty: 5
preferred water station: AquaFlow Malabon
location: 123 Main St, Malabon
email: maria@example.com
number: 09171234567`;

    const result = parseCommunityOrderTemplate(text);
    expect(result.ok).toBe(true);
    expect(result.errors).toEqual([]);
    expect(result.fields.name).toBe("Maria Santos");
    expect(result.fields.delivery).toBe(true);
    expect(result.fields.qty).toBe(5);
    expect(result.fields.number).toBe("09171234567");
    expect(result.looksLikeTemplate).toBe(true);
  });

  it("reports missing order on new form without legacy qty", () => {
    const text = `name: Juan
location: QC`;

    const result = parseCommunityOrderTemplate(text);
    expect(result.ok).toBe(false);
    expect(result.errors).toContain("order");
    expect(result.looksLikeTemplate).toBe(true);
  });

  it("reports missing phone number on legacy form only", () => {
    const text = `name: Juan
delivery: no
qty: 2`;

    const result = parseCommunityOrderTemplate(text);
    expect(result.ok).toBe(false);
    expect(result.errors).toContain("number");
    expect(result.looksLikeTemplate).toBe(true);
  });

  it("requires location when delivery is yes", () => {
    const result = parseCommunityOrderTemplate(`Name: Ana
Order: 2 round - mineral`);

    expect(result.ok).toBe(false);
    expect(result.errors).toContain("location");
  });

  it("does not require number on new order form", () => {
    const result = parseCommunityOrderTemplate(`Name: Ana
Address: QC
Order: 2 round - mineral`);

    expect(result.ok).toBe(true);
    expect(result.errors).not.toContain("number");
  });

  it("treats none and n/a as empty optional contact fields", () => {
    const result = parseCommunityOrderTemplate(`Name: Ana
Address: QC
Email: none
Number: n/a
Order: 2 round - mineral`);

    expect(result.ok).toBe(true);
    expect(result.fields.email).toBeUndefined();
    expect(result.fields.number).toBeUndefined();
  });

  it("accepts Tagalog delivery aliases and pickup on legacy form", () => {
    const pickup = parseCommunityOrderTemplate(`name: Ben
delivery: pickup
qty: 1
number: 09191234567`);
    expect(pickup.fields.delivery).toBe(false);
    expect(pickup.errors).not.toContain("location");

    const padala = parseCommunityOrderTemplate(`name: Ben
padala: oo
qty: 2
number: 09191234567
location: QC`);
    expect(padala.fields.delivery).toBe(true);
  });

  it("tolerates dash separators and blank lines on legacy form", () => {
    const text = `name - Carla

qty: 4
delivery: no
number - 09201234567`;

    const result = parseCommunityOrderTemplate(text);
    expect(result.fields.name).toBe("Carla");
    expect(result.fields.qty).toBe(4);
    expect(result.ok).toBe(true);
  });

  it("does not treat casual hello as template", () => {
    const result = parseCommunityOrderTemplate("hello");
    expect(result.looksLikeTemplate).toBe(false);
  });

  it("parses single-line collapsed Messenger templates", () => {
    const text =
      "name: Justfer delivery: yes qty: 3 preferred water station: water ko to location: muntinlupa email: justfer15@gmail.com number: 09773907598";

    const result = parseCommunityOrderTemplate(text);
    expect(result.looksLikeTemplate).toBe(true);
    expect(result.ok).toBe(true);
    expect(result.fields.name).toBe("Justfer");
    expect(result.fields.delivery).toBe(true);
    expect(result.fields.qty).toBe(3);
    expect(result.fields.number).toBe("09773907598");
  });

  it("parses templates copied with decorative header lines", () => {
    const text = `━━━━━━━━━━━━━━━━━━━━
River Smart Refill — Order Form
━━━━━━━━━━━━━━━━━━━━

name: Justfer
qty: 3
preferred water station: water ko to
location: muntinlupa
email: justfer15@gmail.com
number: 09773907598

━━━━━━━━━━━━━━━━━━━━`;

    const result = parseCommunityOrderTemplate(text);
    expect(result.looksLikeTemplate).toBe(true);
    expect(result.ok).toBe(true);
    expect(result.fields.delivery).toBe(true);
  });

  it("ignores unfilled (Required) and (optional) placeholders", () => {
    const text = `Name: (Required)
Address: Alabang, Muntinlupa City
Email: (optional)
Number: (optional)
Order: 1 slim - purified`;

    const result = parseCommunityOrderTemplate(text);
    expect(result.ok).toBe(false);
    expect(result.errors).toContain("name");
    expect(result.fields.email).toBeUndefined();
    expect(result.fields.number).toBeUndefined();
    expect(result.fields.orderLines).toEqual([
      { qty: 1, container: "slim", waterType: "purified" },
    ]);
  });

  it("parseCommunityOrderLines handles optional dash and casing", () => {
    expect(parseCommunityOrderLines("3 SLIM alkaline, 2 Round — Mineral")).toEqual([
      { qty: 3, container: "slim", waterType: "alkaline" },
      { qty: 2, container: "round", waterType: "mineral" },
    ]);
    expect(formatCommunityOrderLines([
      { qty: 3, container: "slim", waterType: "alkaline" },
      { qty: 2, container: "round", waterType: "mineral" },
    ])).toBe("3 slim - alkaline, 2 round - mineral");
  });

  it("validateCommunityOrderFields flags invalid email", () => {
    const errors = validateCommunityOrderFields({
      name: "Test",
      delivery: false,
      qty: 1,
      number: "09171234567",
      email: "not-an-email",
    });
    expect(errors).toContain("email");
  });
});
