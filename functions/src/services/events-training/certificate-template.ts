/**
 * App-agnostic digital credential SVG template.
 * Light River-inspired palette (teal water greens + soft river blues).
 * Branding text comes from the selected `apps/{appId}` label.
 */

import QRCode from "qrcode";

export type CertificateTemplateInput = {
  /** Product app display name (e.g. Smart Refill, another app). */
  appLabel: string;
  /** Firestore app id — used in verify payload when verifyUrl omitted. */
  appId?: string;
  recipientName: string;
  /**
   * Optional headline override. When omitted, the webinar name is used as the
   * primary credential title.
   */
  title?: string;
  /** Webinar name (required for webinar certificates). */
  courseName: string;
  /** Webinar speaker display name. */
  speaker?: string;
  /** When the webinar ran (localized date). */
  eventDateLabel?: string;
  /** When the certificate was issued / claimed. */
  issuedAtLabel: string;
  certId: string;
  /** Absolute URL encoded in the QR (defaults to river cert payload). */
  verifyUrl?: string;
  /** Remote logo URL (fetched + inlined when logoDataUrl omitted). */
  logoUrl?: string | null;
  /** Pre-fetched data URL (preferred for preview/issue). */
  logoDataUrl?: string | null;
};

function escapeXml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
}

function truncate(value: string, max: number): string {
  const trimmed = value.trim();
  if (trimmed.length <= max) return trimmed;
  return `${trimmed.slice(0, Math.max(1, max - 1)).trimEnd()}…`;
}

export function buildCertificateVerifyUrl(input: {
  certId: string;
  appId?: string;
  verifyUrl?: string;
}): string {
  const custom = input.verifyUrl?.trim();
  if (custom) return custom;
  const certId = encodeURIComponent(input.certId.trim() || "preview");
  const app = encodeURIComponent(input.appId?.trim() || "app");
  return `https://app.smartrefill.io/resources/certificates/verify?cert=${certId}&app=${app}`;
}

async function buildQrDataUrl(payload: string): Promise<string> {
  return QRCode.toDataURL(payload, {
    margin: 1,
    width: 156,
    errorCorrectionLevel: "M",
    color: {
      dark: "#1a4d4a",
      light: "#ffffff",
    },
  });
}

const MAX_LOGO_BYTES = 1_500_000;

/** Fetch a remote logo and return an inlined data URL (null on failure). */
export async function fetchLogoDataUrl(
  logoUrl: string | null | undefined,
): Promise<string | null> {
  const url = typeof logoUrl === "string" ? logoUrl.trim() : "";
  if (!/^https?:\/\//i.test(url)) return null;
  try {
    const res = await fetch(url, {
      redirect: "follow",
      signal: AbortSignal.timeout(8000),
    });
    if (!res.ok) return null;
    const buffer = Buffer.from(await res.arrayBuffer());
    if (buffer.length === 0 || buffer.length > MAX_LOGO_BYTES) return null;
    const contentType = (res.headers.get("content-type") || "image/png")
      .split(";")[0]
      ?.trim() || "image/png";
    if (!contentType.startsWith("image/")) return null;
    return `data:${contentType};base64,${buffer.toString("base64")}`;
  } catch {
    return null;
  }
}

function buildLogoMarkSvg(input: {
  logoDataUrl: string | null;
  appLabel: string;
}): string {
  const monogram = escapeXml(
    (input.appLabel.replace(/[^a-zA-Z0-9]/g, "").charAt(0) || "R").toUpperCase(),
  );
  if (input.logoDataUrl) {
    const href = escapeXml(input.logoDataUrl);
    return `<g transform="translate(552, 68)">
      <circle cx="48" cy="48" r="48" fill="#ffffff" fill-opacity="0.72"/>
      <circle cx="48" cy="48" r="48" fill="none" stroke="#36a69f" stroke-opacity="0.35" stroke-width="2"/>
      <image x="20" y="20" width="56" height="56" href="${href}" preserveAspectRatio="xMidYMid meet"/>
    </g>`;
  }
  return `<g transform="translate(552, 68)">
    <circle cx="48" cy="48" r="48" fill="#ffffff" fill-opacity="0.72"/>
    <circle cx="48" cy="48" r="48" fill="none" stroke="#36a69f" stroke-opacity="0.35" stroke-width="2"/>
    <text x="48" y="60" text-anchor="middle" font-family="ui-sans-serif, system-ui, -apple-system, Segoe UI, sans-serif" font-size="34" font-weight="700" fill="#2d8f89">${monogram}</text>
  </g>`;
}

/** Build a landscape digital credential SVG (1200×850). */
export async function buildCertificateSvg(
  input: CertificateTemplateInput,
): Promise<string> {
  const appLabelRaw = truncate(input.appLabel || "Training", 48);
  const appLabel = escapeXml(appLabelRaw);
  const recipient = escapeXml(truncate(input.recipientName || "Recipient", 64));
  const webinarNameRaw = truncate(
    input.courseName || input.title || "Webinar",
    80,
  );
  const webinarName = escapeXml(webinarNameRaw);
  const speaker = escapeXml(truncate(input.speaker || "Speaker TBA", 64));
  const eventDate = escapeXml(
    truncate(input.eventDateLabel || input.issuedAtLabel || "", 40),
  );
  const certIdRaw = truncate(input.certId || "preview", 48);
  const certId = escapeXml(certIdRaw);
  const verifyUrl = buildCertificateVerifyUrl({
    certId: certIdRaw,
    appId: input.appId,
    verifyUrl: input.verifyUrl,
  });
  const [qrDataUrl, logoDataUrl] = await Promise.all([
    buildQrDataUrl(verifyUrl),
    input.logoDataUrl?.startsWith("data:image/") ?
      Promise.resolve(input.logoDataUrl) :
      fetchLogoDataUrl(input.logoUrl),
  ]);
  const logoMark = buildLogoMarkSvg({
    logoDataUrl,
    appLabel: appLabelRaw,
  });

  return `<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" width="1200" height="850" viewBox="0 0 1200 850" role="img" aria-label="Digital credential">
  <defs>
    <linearGradient id="bg" x1="0" y1="0" x2="1" y2="1">
      <stop offset="0%" stop-color="#f5fffc"/>
      <stop offset="45%" stop-color="#eef9ff"/>
      <stop offset="100%" stop-color="#e7f7f2"/>
    </linearGradient>
    <linearGradient id="blobA" x1="0" y1="0" x2="1" y2="1">
      <stop offset="0%" stop-color="#5eead4" stop-opacity="0.45"/>
      <stop offset="100%" stop-color="#38bdf8" stop-opacity="0.18"/>
    </linearGradient>
    <linearGradient id="blobB" x1="1" y1="0" x2="0" y2="1">
      <stop offset="0%" stop-color="#36a69f" stop-opacity="0.28"/>
      <stop offset="100%" stop-color="#7dd3fc" stop-opacity="0.2"/>
    </linearGradient>
    <linearGradient id="glass" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0%" stop-color="#ffffff" stop-opacity="0.86"/>
      <stop offset="100%" stop-color="#ffffff" stop-opacity="0.62"/>
    </linearGradient>
    <linearGradient id="accent" x1="0" y1="0" x2="1" y2="0">
      <stop offset="0%" stop-color="#2d8f89"/>
      <stop offset="50%" stop-color="#36a69f"/>
      <stop offset="100%" stop-color="#0ea5e9"/>
    </linearGradient>
    <filter id="soft" x="-20%" y="-20%" width="140%" height="140%">
      <feGaussianBlur stdDeviation="18"/>
    </filter>
  </defs>

  <rect width="1200" height="850" fill="url(#bg)"/>
  <ellipse cx="210" cy="160" rx="260" ry="190" fill="url(#blobA)" filter="url(#soft)"/>
  <ellipse cx="1040" cy="220" rx="240" ry="200" fill="url(#blobB)" filter="url(#soft)"/>
  <ellipse cx="620" cy="760" rx="420" ry="180" fill="#36a69f" fill-opacity="0.08" filter="url(#soft)"/>

  <!-- Centered glass card -->
  <rect x="110" y="56" width="980" height="738" rx="36" fill="url(#glass)" stroke="#ffffff" stroke-width="2"/>
  <rect x="110" y="56" width="980" height="738" rx="36" fill="none" stroke="url(#accent)" stroke-opacity="0.35" stroke-width="1.5"/>

  <!-- Floating chip (left) + QR (upper right) -->
  <g font-family="ui-sans-serif, system-ui, -apple-system, Segoe UI, sans-serif">
    <rect x="156" y="88" width="148" height="34" rx="17" fill="#ccfbf1"/>
    <text x="230" y="110" text-anchor="middle" font-size="12" font-weight="600" fill="#0f766e">certified</text>
  </g>

  <g transform="translate(930, 78)">
    <rect x="0" y="0" width="128" height="152" rx="22" fill="#ffffff" fill-opacity="0.95" stroke="#bae6fd" stroke-width="1.5"/>
    <image x="14" y="14" width="100" height="100" href="${qrDataUrl}" />
    <text x="64" y="134" text-anchor="middle" font-family="ui-sans-serif, system-ui, -apple-system, Segoe UI, sans-serif" font-size="10" letter-spacing="1" fill="#0369a1">SCAN ME</text>
  </g>

  ${logoMark}

  <text x="600" y="202" text-anchor="middle" font-family="ui-sans-serif, system-ui, -apple-system, Segoe UI, sans-serif" font-size="13" letter-spacing="4" fill="#0f766e">
    ${appLabel}
  </text>

  <text x="600" y="250" text-anchor="middle" font-family="ui-sans-serif, system-ui, -apple-system, Segoe UI, sans-serif" font-size="14" letter-spacing="3" fill="#0284c7">
    skill unlocked
  </text>
  <text x="600" y="298" text-anchor="middle" font-family="ui-sans-serif, system-ui, -apple-system, Segoe UI, sans-serif" font-size="42" font-weight="760" fill="#0f2f2e">
    Certificate of Completion
  </text>

  <g transform="translate(600, 324)">
    <rect x="-54" y="-4" width="108" height="8" rx="4" fill="url(#accent)"/>
  </g>

  <text x="600" y="368" text-anchor="middle" font-family="ui-sans-serif, system-ui, -apple-system, Segoe UI, sans-serif" font-size="13" letter-spacing="2.5" fill="#5b8a92">
    AWARDED TO
  </text>
  <text x="600" y="424" text-anchor="middle" font-family="ui-sans-serif, system-ui, -apple-system, Segoe UI, sans-serif" font-size="46" font-weight="700" fill="#123836">
    ${recipient}
  </text>

  <text x="600" y="468" text-anchor="middle" font-family="ui-sans-serif, system-ui, -apple-system, Segoe UI, sans-serif" font-size="15" fill="#5b7c86">
    for attending
  </text>
  <text x="600" y="508" text-anchor="middle" font-family="ui-sans-serif, system-ui, -apple-system, Segoe UI, sans-serif" font-size="26" font-weight="700" fill="#0f766e">
    ${webinarName}
  </text>
  <text x="600" y="542" text-anchor="middle" font-family="ui-sans-serif, system-ui, -apple-system, Segoe UI, sans-serif" font-size="16" fill="#3d6b7a">
    with ${speaker}
  </text>

  <!-- Centered footer meta: when it happened + issuing app -->
  <g transform="translate(600, 600)" font-family="ui-sans-serif, system-ui, -apple-system, Segoe UI, sans-serif">
    <rect x="-300" y="0" width="180" height="72" rx="22" fill="#ffffff" fill-opacity="0.78" stroke="#ccfbf1"/>
    <text x="-210" y="28" text-anchor="middle" font-size="11" letter-spacing="1.5" fill="#0f766e">WHEN</text>
    <text x="-210" y="54" text-anchor="middle" font-size="15" font-weight="650" fill="#123836">${eventDate}</text>

    <rect x="120" y="0" width="180" height="72" rx="22" fill="#ffffff" fill-opacity="0.78" stroke="#bae6fd"/>
    <text x="210" y="28" text-anchor="middle" font-size="11" letter-spacing="1.5" fill="#0369a1">AUTH BY</text>
    <text x="210" y="54" text-anchor="middle" font-size="15" font-weight="650" fill="#123836">${appLabel}</text>
  </g>

  <text x="600" y="760" text-anchor="middle" font-family="ui-sans-serif, system-ui, -apple-system, Segoe UI, sans-serif" font-size="12" fill="#7a9aa2">
    river · ${certId}
  </text>
</svg>
`;
}

export function formatCertificateIssueDate(
  date = new Date(),
  timeZone = "Asia/Manila",
): string {
  return date.toLocaleDateString("en-PH", {
    timeZone,
    year: "numeric",
    month: "long",
    day: "numeric",
  });
}
