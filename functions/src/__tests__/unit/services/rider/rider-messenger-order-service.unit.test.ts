import { describe, expect, it } from "vitest";
import {
  formatOrderCreatedMessage,
  parseRiderMessengerOrderArg,
} from "../../../../services/rider/rider-messenger-order-service";
import { parseRiderMessengerOrderLineTail } from "../../../../services/rider/rider-messenger-order-lines-service";

describe("parseRiderMessengerOrderLineTail", () => {
  it("parses single and multiple delivery lines", () => {
    expect(parseRiderMessengerOrderLineTail("3 slim alkaline")).toEqual([
      { qty: 3, container: "slim", waterType: "alkaline" },
    ]);
    expect(parseRiderMessengerOrderLineTail("3 slim - alkaline, 2 round purified")).toEqual([
      { qty: 3, container: "slim", waterType: "alkaline" },
      { qty: 2, container: "round", waterType: "purified" },
    ]);
    expect(parseRiderMessengerOrderLineTail("3 slim alkaline + 2 round purified")).toEqual([
      { qty: 3, container: "slim", waterType: "alkaline" },
      { qty: 2, container: "round", waterType: "purified" },
    ]);
  });
});

describe("parseRiderMessengerOrderArg", () => {
  it("parses target only", () => {
    expect(parseRiderMessengerOrderArg("2")).toEqual({ target: "2" });
  });

  it("parses delivery with explicit lines", () => {
    expect(parseRiderMessengerOrderArg("2 DEL 3 slim alkaline, 2 round purified")).toEqual({
      target: "2",
      type: "delivery",
      orderLines: [
        { qty: 3, container: "slim", waterType: "alkaline" },
        { qty: 2, container: "round", waterType: "purified" },
      ],
      orderRaw: "3 slim alkaline, 2 round purified",
    });
  });

  it("parses bare qty when not a line pattern", () => {
    expect(parseRiderMessengerOrderArg("2 DELIVERY 5")).toEqual({
      target: "2",
      type: "delivery",
      qty: 5,
    });
  });

  it("parses collection shorthand", () => {
    expect(parseRiderMessengerOrderArg("3 COL")).toEqual({
      target: "3",
      type: "collection",
    });
  });
});

describe("formatOrderCreatedMessage", () => {
  it("includes reference, quiet days, and line items", () => {
    const msg = formatOrderCreatedMessage({
      customerName: "Ben",
      referenceId: "TX-2001",
      type: "delivery",
      summaryLines: ["• 3 Alkaline (slim)", "• 2 Purified (round)"],
      daysSinceLastOrder: 12,
    });
    expect(msg).toContain("Ben");
    expect(msg).toContain("TX-2001");
    expect(msg).toContain("Alkaline (slim)");
    expect(msg).toContain("quiet 12d");
  });
});
