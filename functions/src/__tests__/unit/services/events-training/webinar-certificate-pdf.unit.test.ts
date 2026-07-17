import { describe, expect, it } from "vitest";
import {
  buildCertificateSvg,
  buildCertificateVerifyUrl,
  formatCertificateIssueDate,
} from "../../../../services/events-training/certificate-template";
import {
  buildWebinarCertificatePdf,
  webinarCertificateFilename,
} from "../../../../services/events-training/webinar-certificate-pdf";

describe("certificate-template (member PDF source)", () => {
  it("matches Sales Portal preview copy", async () => {
    const svg = await buildCertificateSvg({
      appLabel: "smartrefill",
      appId: "smartrefill",
      recipientName: "Alex Rivera",
      courseName: "How to train your dragon",
      speaker: "Goku",
      eventDateLabel: "July 15, 2026",
      issuedAtLabel: "July 16, 2026",
      certId: "preview",
    });
    expect(svg).toContain("Certificate of Completion");
    expect(svg).toContain("skill unlocked");
    expect(svg).toContain("AWARDED TO");
    expect(svg).toContain("Alex Rivera");
    expect(svg).toContain("How to train your dragon");
    expect(svg).toContain("with Goku");
    expect(svg).toContain("SCAN ME");
    expect(svg).toContain("certified");
    expect(svg).toContain("WHEN");
    expect(svg).toContain("AUTH BY");
    expect(svg).toContain("river · preview");
  });

  it("builds Asia/Manila long dates", () => {
    expect(
      formatCertificateIssueDate(new Date("2026-07-15T04:00:00.000Z")),
    ).toMatch(/July 15, 2026/);
  });

  it("builds verify URLs", () => {
    expect(buildCertificateVerifyUrl({ certId: "abc", appId: "smartrefill" })).toContain(
      "cert=abc",
    );
  });
});

describe("webinar-certificate-pdf", () => {
  it("embeds the River credential template as a PDF", async () => {
    const buffer = await buildWebinarCertificatePdf({
      recipientName: "Justfer Himbings",
      title: "How to train your dragon",
      speaker: "Goku",
      eventStartsAt: "2026-07-15T04:00:00.000Z",
      issuedAt: "2026-07-16T01:00:00.000Z",
      certificateId: "Sa1X9YX3E6wLIYLNNjJo",
      logoUrl: null,
    });
    expect(Buffer.isBuffer(buffer)).toBe(true);
    expect(buffer.length).toBeGreaterThan(2000);
    expect(buffer.subarray(0, 4).toString("utf8")).toBe("%PDF");
  }, 20_000);

  it("slugifies filenames", () => {
    expect(webinarCertificateFilename("How to train your dragon!", "evt-1")).toBe(
      "webinar-certificate-how-to-train-your-dragon.pdf",
    );
  });
});
