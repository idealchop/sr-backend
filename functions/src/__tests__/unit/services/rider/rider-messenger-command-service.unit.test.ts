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

  it("parses DONE with optional CASH amount", () => {
    expect(parseRiderMessengerCommand("DONE 2 CASH 150")).toEqual({
      kind: "done",
      target: "2",
      cashAmount: 150,
    });
    expect(parseRiderMessengerCommand("DONE TX-1042 CASH 99.50")).toEqual({
      kind: "done",
      target: "TX-1042",
      cashAmount: 99.5,
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
    expect(parseRiderMessengerCommand("REASON 2")).toEqual({
      kind: "reason",
      index: 2,
    });
    expect(parseRiderMessengerCommand("REASON 4 - customer nagtext")).toEqual({
      kind: "reason",
      index: 4,
      detail: "customer nagtext",
    });
    expect(parseRiderMessengerCommand("DONE GROUP 1")).toEqual({
      kind: "done",
      target: "GROUP 1",
      groupNumber: "1",
    });
    expect(parseRiderMessengerCommand("FAIL GROUP 2")).toEqual({
      kind: "fail",
      target: "GROUP 2",
      groupNumber: "2",
    });
    expect(parseRiderMessengerCommand("DONE GROUP 1 CASH 300")).toEqual({
      kind: "done",
      target: "GROUP 1",
      groupNumber: "1",
      cashAmount: 300,
    });
    expect(parseRiderMessengerCommand("DONE 1,2,3")).toEqual({
      kind: "done",
      target: "1,2,3",
      targets: ["1", "2", "3"],
    });
    expect(parseRiderMessengerCommand("DONE 1 to 5")).toEqual({
      kind: "done",
      target: "1,2,3,4,5",
      targets: ["1", "2", "3", "4", "5"],
    });
    expect(parseRiderMessengerCommand("FAIL 1,2")).toEqual({
      kind: "fail",
      target: "1,2",
      targets: ["1", "2"],
    });
    expect(parseRiderMessengerCommand("CANCEL 1-3")).toEqual({
      kind: "cancel",
      target: "1,2,3",
      targets: ["1", "2", "3"],
    });
    expect(parseRiderMessengerCommand("DONE 1,2 CASH 200")).toEqual({
      kind: "done",
      target: "1,2",
      targets: ["1", "2"],
      cashAmount: 200,
    });
  });

  it("parses HELP and confirm", () => {
    expect(parseRiderMessengerCommand("HELP")).toEqual({ kind: "help" });
    expect(parseRiderMessengerCommand("NEARBY")).toEqual({ kind: "nearby" });
    expect(parseRiderMessengerCommand("GROUP 1")).toEqual({ kind: "group", target: "1" });
    expect(parseRiderMessengerCommand("YES")).toEqual({ kind: "confirm_yes" });
    expect(parseRiderMessengerCommand("NO")).toEqual({ kind: "confirm_no" });
    expect(parseRiderMessengerCommand("CHAT")).toEqual({ kind: "chat_open" });
    expect(parseRiderMessengerCommand("CLOSE CHAT")).toEqual({ kind: "chat_close" });
  });

  it("parses DETAILS and ORDER", () => {
    expect(parseRiderMessengerCommand("DETAILS 2")).toEqual({
      kind: "details",
      target: "2",
    });
    expect(parseRiderMessengerCommand("ORDER 2")).toEqual({
      kind: "order",
      target: "2",
    });
    expect(parseRiderMessengerCommand("ORDER 2 DELIVERY 5")).toEqual({
      kind: "order",
      target: "2",
      orderType: "delivery",
      orderQty: 5,
    });
    expect(parseRiderMessengerCommand("ORDER 2 DEL 3 slim alkaline, 2 round purified")).toEqual({
      kind: "order",
      target: "2",
      orderType: "delivery",
      orderLines: [
        { qty: 3, container: "slim", waterType: "alkaline" },
        { qty: 2, container: "round", waterType: "purified" },
      ],
      orderRaw: "3 slim alkaline, 2 round purified",
    });
    expect(parseRiderMessengerCommand("ORDER 3 COL 2")).toEqual({
      kind: "order",
      target: "3",
      orderType: "collection",
      orderQty: 2,
    });
  });
});
