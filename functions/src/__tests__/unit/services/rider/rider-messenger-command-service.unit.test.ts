import { describe, expect, it } from "vitest";
import { parseRiderMessengerCommand } from "../../../../services/rider/rider-messenger-command-service";

describe("parseRiderMessengerCommand", () => {
  it("parses LINK with code", () => {
    expect(parseRiderMessengerCommand("LINK RDR-7K2M")).toEqual({
      kind: "link",
      code: "RDR-7K2M",
    });
  });

  it("parses JOBS filters", () => {
    expect(parseRiderMessengerCommand("JOBS")).toEqual({ kind: "jobs", filter: "all" });
    expect(parseRiderMessengerCommand("JOBS DELIVERY")).toEqual({
      kind: "jobs",
      filter: "delivery",
    });
    expect(parseRiderMessengerCommand("jobs collection")).toEqual({
      kind: "jobs",
      filter: "collection",
    });
  });

  it("parses status commands", () => {
    expect(parseRiderMessengerCommand("START 2")).toEqual({ kind: "start", target: "2" });
    expect(parseRiderMessengerCommand("DONE TX-1042")).toEqual({
      kind: "done",
      target: "TX-1042",
    });
    expect(parseRiderMessengerCommand("FAIL 1")).toEqual({ kind: "fail", target: "1" });
    expect(parseRiderMessengerCommand("CANCEL 3")).toEqual({ kind: "cancel", target: "3" });
  });

  it("parses HELP and confirm", () => {
    expect(parseRiderMessengerCommand("HELP")).toEqual({ kind: "help" });
    expect(parseRiderMessengerCommand("YES")).toEqual({ kind: "confirm_yes" });
    expect(parseRiderMessengerCommand("NO")).toEqual({ kind: "confirm_no" });
  });
});
