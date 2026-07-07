import { describe, expect, it } from "vitest";
import {
  buildCommunityDeliveryCompleteMessage,
  buildCommunityNearbyStationsAckMessage,
  resolveCommunityOrderPaymentReminder,
  buildCommunityOrderAcceptedMessage,
  buildCommunityOrderInTransitMessage,
  buildCommunityOrderSummaryMessage,
  buildCommunityOrderTrackUrl,
  buildCommunityWaitNudgeMessage,
} from "../../../../services/meta/community-messenger-customer-notifier";

describe("community-messenger-customer-notifier", () => {
  it("builds nearby stations ack for broadcast intake", () => {
    const message = buildCommunityNearbyStationsAckMessage({
      referenceId: "CR-ABC12345",
      nearbyCount: 3,
      searchRadiusKm: 5,
      offerResponseMinutes: 3,
    });

    expect(message).toContain("CR-ABC12345");
    expect(message).toContain("3 malapit na stations");
    expect(message).toContain("5 km");
    expect(message).toContain("3 min");
    expect(message).toContain("unang tumanggap");
    expect(message).toContain("Sandali lang po");
    expect(message).toContain("CANCEL - {reason}");
    expect(message).not.toContain("reply CANCEL to cancel");
    expect(message).not.toContain("Narito ang na-save");
  });

  it("builds wait nudge while stations consider the order", () => {
    const message = buildCommunityWaitNudgeMessage("CR-ABC12345");
    expect(message).toContain("CR-ABC12345");
    expect(message).toContain("Hinahanap pa namin");
    expect(message).toContain("Sandali lang po");
  });

  it("builds in-transit update with track link", () => {
    const trackUrl = "https://app.smartrefill.io/order?b=biz-1&ref=TX-1";
    const message = buildCommunityOrderInTransitMessage({
      referenceId: "TX-1",
      trackUrl,
      riderName: "Juan",
    });
    expect(message).toContain("Update sa order mo");
    expect(message).toContain("Rider: Juan");
    expect(message).toContain(trackUrl);
  });

  it("builds order summary with station and verified location", () => {
    const message = buildCommunityOrderSummaryMessage({
      referenceId: "CR-ABC12345",
      stationName: "Water Ko To",
      geocode: {
        latitude: 14.4,
        longitude: 121.0,
        formattedAddress: "Putatan, Muntinlupa, Philippines",
      },
      fields: {
        name: "Testing",
        delivery: true,
        qty: 4,
        number: "09123456789",
      },
    });

    expect(message).toContain("Narito ang na-save namin");
    expect(message).toContain("Address (verified):");
    expect(message).toContain("Station: Water Ko To");
  });

  it("builds order track URL for portal deep link", () => {
    const prevDev = process.env.SMARTREFILL_ENV_DEV;
    const prevApp = process.env.APP_BASE_URL;
    delete process.env.SMARTREFILL_ENV_DEV;
    delete process.env.APP_BASE_URL;
    try {
      const url = buildCommunityOrderTrackUrl({
        businessId: "biz-wrs-1",
        referenceId: "TX-260625-ABCD",
      });

      expect(url).toMatch(/\/order\?/);
      expect(url).toContain("https://app.smartrefill.io/order");
      expect(url).toContain("b=biz-wrs-1");
      expect(url).toContain("ref=TX-260625-ABCD");
    } finally {
      if (prevDev !== undefined) process.env.SMARTREFILL_ENV_DEV = prevDev;
      else delete process.env.SMARTREFILL_ENV_DEV;
      if (prevApp !== undefined) process.env.APP_BASE_URL = prevApp;
      else delete process.env.APP_BASE_URL;
    }
  });

  it("builds order accepted message with summary, distance, and ETA", () => {
    const trackUrl =
      "https://app.smartrefill.io/order?b=biz-wrs-1&ref=TX-260625-ABCD";
    const message = buildCommunityOrderAcceptedMessage({
      stationName: "Water Ko To",
      referenceId: "TX-260625-ABCD",
      trackUrl,
      fields: {
        name: "Maria",
        delivery: true,
        qty: 5,
        number: "09171234567",
        location: "Putatan, Muntinlupa",
      },
      geocode: {
        latitude: 14.38,
        longitude: 121.04,
        formattedAddress: "Putatan, Muntinlupa, Philippines",
      },
      distanceKm: 2.4,
      etaMinutes: 23,
    });

    expect(message).toContain("tumanggap");
    expect(message).toContain("Water Ko To");
    expect(message).toContain("TX-260625-ABCD");
    expect(message).toContain("Order mo:");
    expect(message).toContain("Maria");
    expect(message).toContain("2.4 km");
    expect(message).toContain("Estimated delivery:");
    expect(message).toContain("about 23 minutes");
    expect(message).toContain(trackUrl);
    expect(message).not.toContain("CANCEL");
  });

  it("builds delivery complete message with pay prompt when unpaid", () => {
    const message = buildCommunityDeliveryCompleteMessage({
      referenceId: "TX-260629-5G8M",
      trackUrl: "https://app.smartrefill.io/order?b=biz-1&ref=TX-260629-5G8M",
      paymentReminder: "unpaid",
      receiptChannel: "messenger",
    });

    expect(message).toContain("Tapos na ang delivery mo");
    expect(message).toContain("magbayad");
    expect(message).toContain("Ipapadala ang official receipt dito sa Messenger");
    expect(message).toContain("https://app.smartrefill.io/order");
  });

  it("builds delivery complete message with email receipt hint when email provided", () => {
    const message = buildCommunityDeliveryCompleteMessage({
      referenceId: "TX-260629-5G8M",
      trackUrl: "https://app.smartrefill.io/order?b=biz-1&ref=TX-260629-5G8M",
      receiptChannel: "email",
      receiptEmail: "maria@example.com",
    });

    expect(message).toContain("Ipapadala ang official receipt sa email mo");
    expect(message).toContain("maria@example.com");
    expect(message).not.toContain("dito sa Messenger");
  });

  it("builds delivery complete message with balance when partially paid", () => {
    const message = buildCommunityDeliveryCompleteMessage({
      referenceId: "TX-260629-5G8M",
      trackUrl: "https://app.smartrefill.io/order?b=biz-1&ref=TX-260629-5G8M",
      paymentReminder: "partial",
      balanceDue: 150,
    });

    expect(message).toContain("bayaran ang natitira");
    expect(message).toContain("₱150");
  });

  it("resolveCommunityOrderPaymentReminder maps unpaid and partial", () => {
    expect(resolveCommunityOrderPaymentReminder("unpaid")).toBe("unpaid");
    expect(resolveCommunityOrderPaymentReminder("partial")).toBe("partial");
    expect(resolveCommunityOrderPaymentReminder("paid")).toBe("none");
  });
});
