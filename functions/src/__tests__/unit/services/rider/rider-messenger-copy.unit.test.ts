import {
  buildRiderMessengerHelpText,
  resolveRiderMessengerGuideUrl,
  RIDER_MESSENGER_GUIDE_PATH,
} from "../../../../services/rider/rider-messenger-copy";

describe("rider-messenger-copy", () => {
  it("exposes public guide path", () => {
    expect(RIDER_MESSENGER_GUIDE_PATH).toBe("/guides/rider-messenger-user-guide.html");
  });

  it("builds guide URL from app base", () => {
    expect(resolveRiderMessengerGuideUrl("https://app.smartrefill.io")).toBe(
      "https://app.smartrefill.io/guides/rider-messenger-user-guide.html",
    );
  });

  it("HELP text lists frequent commands and full guide link", () => {
    const text = buildRiderMessengerHelpText("https://app.smartrefill.io");
    expect(text).toContain("Madalas gamitin:");
    expect(text).toContain("JOBS");
    expect(text).toContain("START #");
    expect(text).toContain("DONE #");
    expect(text).toContain("Buong command guide:");
    expect(text).toContain("/guides/rider-messenger-user-guide.html");
    expect(text.length).toBeLessThan(2000);
  });
});
