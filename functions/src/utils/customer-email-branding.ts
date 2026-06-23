import { escapeHtmlForEmail } from "./auth-transactional-email";

const BRAND_COLOR = "#44c1ba";

export type CustomerEmailBrand = {
  businessName: string;
  businessLogoUrl?: string | null;
};

/** Reads a public HTTPS logo URL from a business Firestore document. */
export function resolveBusinessEmailLogoUrl(logo: unknown): string | null {
  if (typeof logo !== "string") return null;
  const trimmed = logo.trim();
  if (!trimmed || !/^https?:\/\//i.test(trimmed)) return null;
  return trimmed;
}

export function resolveCustomerEmailBrand(
  biz: Record<string, unknown>,
): CustomerEmailBrand {
  return {
    businessName: String(biz.name || biz.businessName || "Your water station"),
    businessLogoUrl: resolveBusinessEmailLogoUrl(biz.logo),
  };
}

function businessInitial(name: string): string {
  const letter = name.trim().charAt(0).toUpperCase();
  return letter || "W";
}

function logoOrInitialHtml(brand: CustomerEmailBrand): string {
  const name = escapeHtmlForEmail(brand.businessName.trim() || "Your water station");
  const logoUrl = resolveBusinessEmailLogoUrl(brand.businessLogoUrl);
  if (logoUrl) {
    return `<img src="${escapeHtmlForEmail(logoUrl)}" width="44" height="44" alt="${name}" style="display:block;border-radius:10px;object-fit:cover;" />`;
  }
  const initial = escapeHtmlForEmail(businessInitial(brand.businessName));
  return `<div style="width:44px;height:44px;border-radius:10px;background-color:${BRAND_COLOR};color:#ffffff;font-size:18px;font-weight:700;line-height:44px;text-align:center;">${initial}</div>`;
}

/** Masthead row: business logo (or initial) + business name + optional eyebrow. */
export function buildCustomerEmailMastheadHtml(
  brand: CustomerEmailBrand,
  eyebrow: string,
): string {
  const name = escapeHtmlForEmail(brand.businessName.trim() || "Your water station");
  const eyebrowHtml = escapeHtmlForEmail(eyebrow);
  return `
<table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0">
  <tr>
    <td style="padding:24px 28px 20px;border-bottom:3px solid ${BRAND_COLOR};background-color:#fbfcfd;">
      <table role="presentation" cellspacing="0" cellpadding="0" border="0">
        <tr>
          <td style="vertical-align:middle;padding-right:14px;">
            ${logoOrInitialHtml(brand)}
          </td>
          <td style="vertical-align:middle;">
            <p style="margin:0;font-size:20px;font-weight:700;color:#0f172a;">${name}</p>
            <p style="margin:6px 0 0;font-size:10px;font-weight:600;letter-spacing:0.14em;text-transform:uppercase;color:#64748b;">
              ${eyebrowHtml}
            </p>
          </td>
        </tr>
      </table>
    </td>
  </tr>
</table>`;
}

/** Footer: business name + platform attribution. */
export function buildCustomerEmailFooterHtml(brand: CustomerEmailBrand): string {
  const name = escapeHtmlForEmail(brand.businessName.trim() || "Your water station");
  const year = new Date().getFullYear();
  return `
<tr>
  <td style="padding:20px 32px 28px;border-top:1px solid #e2e8f0;background-color:#f8fafc;text-align:center;">
    <p style="margin:0;font-size:11px;font-weight:700;letter-spacing:0.08em;text-transform:uppercase;color:#64748b;">
      ${name}
    </p>
    <p style="margin:10px 0 0;font-size:11px;font-weight:700;letter-spacing:0.08em;text-transform:uppercase;color:#64748b;">
      Powered by Smart Refill
    </p>
    <p style="margin:8px 0 0;font-size:11px;color:#94a3b8;">
      River Tech Inc. · <a href="https://riverph.com/" style="color:#0f766e;text-decoration:none;">riverph.com</a>
    </p>
    <p style="margin:8px 0 0;font-size:10px;color:#cbd5e1;">© ${year} · All rights reserved</p>
  </td>
</tr>`;
}

/** Plain-text footer for customer transactional emails. */
export function buildCustomerEmailFooterPlainText(businessName: string): string {
  const year = new Date().getFullYear();
  return (
    `—\n${businessName.trim() || "Your water station"}\n` +
    "Powered by Smart Refill\n" +
    "River Tech Inc. · https://riverph.com/\n" +
    `© ${year} · All rights reserved`
  );
}

/** Shared outer shell for customer lifecycle emails (order received, status updates). */
export function wrapCustomerLifecycleEmailHtml(args: {
  brand: CustomerEmailBrand;
  eyebrow: string;
  preheader: string;
  bodyHtml: string;
}): string {
  const preheader = escapeHtmlForEmail(args.preheader);
  return `
<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>${escapeHtmlForEmail(args.brand.businessName)}</title>
</head>
<body style="margin:0;padding:0;background-color:#e8eef4;font-family:'Segoe UI',Arial,sans-serif;">
  <div style="display:none;max-height:0;overflow:hidden;">${preheader}</div>
  <table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0" style="background-color:#e8eef4;">
    <tr>
      <td align="center" style="padding:28px 14px 40px;">
        <table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0"
          style="max-width:600px;background-color:#ffffff;border:1px solid #d8e2ec;border-radius:14px;overflow:hidden;">
          <tr>
            <td style="padding:0;">
              ${buildCustomerEmailMastheadHtml(args.brand, args.eyebrow)}
            </td>
          </tr>
          <tr>
            <td style="padding:32px 32px 28px;">
              ${args.bodyHtml}
            </td>
          </tr>
          ${buildCustomerEmailFooterHtml(args.brand)}
        </table>
      </td>
    </tr>
  </table>
</body>
</html>`;
}
