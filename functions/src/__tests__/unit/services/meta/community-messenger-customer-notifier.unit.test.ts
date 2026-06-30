import { describe, expect, it } from "vitest";
import {
  buildCommunityDeliveryCompleteMessage,
  buildCommunityNearbyStationsAckMessage,
  resolveCommunityOrderPaymentReminder,
  buildCommunityOrderAcceptedMessage,
  buildCommunityOrderSummaryMessage,
  buildCommunityOrderTrackUrl,
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
    expect(message).toContain("3 nearby refilling stations");
    expect(message).toContain("Current search radius: 5 km");
    expect(message).toContain("up to 3 minutes");
    expect(message).toContain("first station to accept");
    expect(message).toContain("reply CANCEL");
    expect(message).not.toContain("Here's what we captured");
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

    expect(message).toContain("Here's what we captured");
    expect(message).toContain("Location verified:");
    expect(message).toContain("Station: Water Ko To");
  });

  it("builds order track URL for portal deep link", () => {
    const url = buildCommunityOrderTrackUrl({
      businessId: "biz-wrs-1",
      referenceId: "TX-260625-ABCD",
    });

    expect(url).toMatch(/\/order\?/);
    expect(url).toContain("https://app.smartrefill.io/order");
    expect(url).toContain("b=biz-wrs-1");
    expect(url).toContain("ref=TX-260625-ABCD");
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

    expect(message).toContain("accepted");
    expect(message).toContain("Water Ko To");
    expect(message).toContain("TX-260625-ABCD");
    expect(message).toContain("Order summary:");
    expect(message).toContain("Maria");
    expect(message).toContain("2.4 km");
    expect(message).toContain("Estimated delivery:");
    expect(message).toContain("about 23 minutes");
    expect(message).toContain(trackUrl);
  });

  it("builds delivery complete message with pay prompt when unpaid", () => {
    const message = buildCommunityDeliveryCompleteMessage({
      referenceId: "TX-260629-5G8M",
      trackUrl: "https://app.smartrefill.io/order?b=biz-1&ref=TX-260629-5G8M",
      paymentReminder: "unpaid",
      receiptChannel: "messenger",
    });

    expect(message).toContain("Your delivery is complete");
    expect(message).toContain("pay your order");
    expect(message).toContain("follow here in Messenger");
    expect(message).toContain("https://app.smartrefill.io/order");
  });

  it("builds delivery complete message with email receipt hint when email provided", () => {
    const message = buildCommunityDeliveryCompleteMessage({
      referenceId: "TX-260629-5G8M",
      trackUrl: "https://app.smartrefill.io/order?b=biz-1&ref=TX-260629-5G8M",
      receiptChannel: "email",
      receiptEmail: "maria@example.com",
    });

    expect(message).toContain("sent to the email you provided");
    expect(message).toContain("maria@example.com");
    expect(message).not.toContain("follow here in Messenger");
  });

  it("builds delivery complete message with balance when partially paid", () => {
    const message = buildCommunityDeliveryCompleteMessage({
      referenceId: "TX-260629-5G8M",
      trackUrl: "https://app.smartrefill.io/order?b=biz-1&ref=TX-260629-5G8M",
      paymentReminder: "partial",
      balanceDue: 150,
    });

    expect(message).toContain("pay your remaining balance");
    expect(message).toContain("₱150");
  });

  it("resolveCommunityOrderPaymentReminder maps unpaid and partial", () => {
    expect(resolveCommunityOrderPaymentReminder("unpaid")).toBe("unpaid");
    expect(resolveCommunityOrderPaymentReminder("partial")).toBe("partial");
    expect(resolveCommunityOrderPaymentReminder("paid")).toBe("none");
  });
});
