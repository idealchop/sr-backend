import { describe, expect, it } from "vitest";
import {
  parseCommunityOrderTemplate,
  validateCommunityOrderFields,
} from "../../../../services/meta/community-dispatch-template-parser";

describe("community-dispatch-template-parser", () => {
  it("parses delivery-first template without delivery line", () => {
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

  it("parses a complete template", () => {
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

  it("reports missing phone number", () => {
    const text = `name: Juan
delivery: no
qty: 2`;

    const result = parseCommunityOrderTemplate(text);
    expect(result.ok).toBe(false);
    expect(result.errors).toContain("number");
    expect(result.looksLikeTemplate).toBe(true);
  });

  it("requires location when delivery is yes", () => {
    const result = parseCommunityOrderTemplate(`name: Ana
delivery: yes
qty: 3
number: 09181234567`);

    expect(result.ok).toBe(false);
    expect(result.errors).toContain("location");
  });

  it("accepts Tagalog delivery aliases and pickup", () => {
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

  it("tolerates dash separators and blank lines", () => {
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

  it("parses simplified order form labels", () => {
    const text = `Name: Justfer
Quantity: 3
Water: alkaline
Address: muntinlupa
Email: justfer15@gmail.com
Phone Number: 09773907598`;

    const result = parseCommunityOrderTemplate(text);
    expect(result.looksLikeTemplate).toBe(true);
    expect(result.ok).toBe(true);
    expect(result.fields.name).toBe("Justfer");
    expect(result.fields.qty).toBe(3);
    expect(result.fields.preferredWaterType).toBe("alkaline");
    expect(result.fields.location).toBe("muntinlupa");
    expect(result.fields.number).toBe("09773907598");
  });

  it("parses shorthand quantity with unit suffix", () => {
    const result = parseCommunityOrderTemplate(`Name: Ana
Quantity: 3 gal
Address: QC
Phone Number: 09171234567`);
    expect(result.ok).toBe(true);
    expect(result.fields.qty).toBe(3);
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
