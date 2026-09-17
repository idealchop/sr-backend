import { describe, expect, it, vi } from "vitest";

vi.mock("../../../../config/firebase-admin", () => ({
  db: {},
  FieldValue: { serverTimestamp: () => "SERVER_TS" },
}));

vi.mock("../../../../services/events-training/events-training-collections", () => ({
  EVENTS_TRAINING_COLLECTIONS: { webinarEventFeedback: "webinar_event_feedback" },
  eventsTrainingRoot: () => ({ collection: () => ({}) }),
  webinarRegistrationsCollection: () => ({}),
  webinarsCollection: () => ({}),
}));

import {
  buildWebinarFeedbackPath,
  webinarEmailActionButtonsHtml,
} from "../../../../utils/webinar-email-cta";
import { webinarFeedbackDocId } from "../../../../services/events-training/webinar-feedback-service";

describe("webinar email feedback CTA", () => {
  it("builds a tokenized feedback path", () => {
    expect(buildWebinarFeedbackPath({ token: "abc" })).toBe(
      "/resources/webinars/feedback?t=abc",
    );
  });

  it("renders join and ratings buttons", () => {
    const html = webinarEmailActionButtonsHtml({
      primaryUrl: "https://smartrefill.io/join",
      primaryLabel: "Join webinar",
      feedbackUrl: "https://smartrefill.io/feedback",
    });
    expect(html).toContain("Join webinar");
    expect(html).toContain("Provide ratings and feedback");
    expect(html).toContain("https://smartrefill.io/feedback");
  });
});

describe("webinarFeedbackDocId", () => {
  it("is stable per event and email", () => {
    const a = webinarFeedbackDocId("event-1", "Ada@Example.com");
    const b = webinarFeedbackDocId("event-1", "ada@example.com");
    expect(a).toBe(b);
    expect(a.startsWith("fb_")).toBe(true);
  });
});
