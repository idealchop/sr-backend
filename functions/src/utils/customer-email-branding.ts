import { escapeHtmlForEmail } from "./auth-transactional-email";
import {
  buildSmartRefillEmailFooterPlainText,
  wrapSmartRefillLetterHtml,
} from "./smartrefill-email-html";

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
<table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0" style="margin:0 0 20px;">
  <tr>
    <td>
      <table role="presentation" cellspacing="0" cellpadding="0" border="0">
        <tr>
          <td style="vertical-align:middle;padding-right:14px;">
            ${logoOrInitialHtml(brand)}
          </td>
          <td style="vertical-align:middle;">
            <p style="margin:0;font-size:16px;font-weight:700;color:#172b4d;">${name}</p>
            <p style="margin:4px 0 0;font-size:12px;color:#5e6c84;">
              ${eyebrowHtml}
            </p>
          </td>
        </tr>
      </table>
    </td>
  </tr>
</table>`;
}

/** Footer: station name + Smart Refill legal links. */
export function buildCustomerEmailFooterHtml(brand: CustomerEmailBrand): string {
  const name = escapeHtmlForEmail(brand.businessName.trim() || "Your water station");
  return `
<tr>
  <td style="padding:20px 32px 8px;text-align:center;">
    <p style="margin:0;font-size:11px;font-weight:700;letter-spacing:0.08em;text-transform:uppercase;color:#64748b;">
      ${name} · Powered by Smart Refill
    </p>
  </td>
</tr>`;
}

/** Plain-text footer for customer transactional emails. */
export function buildCustomerEmailFooterPlainText(businessName: string): string {
  return (
    `—\n${businessName.trim() || "Your water station"}\n` +
    "Powered by Smart Refill\n" +
    buildSmartRefillEmailFooterPlainText()
  );
}

/** Shared outer shell for customer lifecycle emails (order received, status updates). */
export function wrapCustomerLifecycleEmailHtml(args: {
  brand: CustomerEmailBrand;
  eyebrow: string;
  preheader: string;
  bodyHtml: string;
}): string {
  const name = args.brand.businessName.trim() || "Your water station";
  return wrapSmartRefillLetterHtml({
    title: name,
    headline: args.eyebrow,
    preheader: args.preheader,
    omitHeadline: true,
    includeSignOff: false,
    bodyHtml: `${buildCustomerEmailMastheadHtml(args.brand, args.eyebrow)}${args.bodyHtml}
      <p style="margin:28px 0 0;font-size:15px;line-height:1.6;color:#172b4d;">Cheers,<br />${escapeHtmlForEmail(name)}</p>`,
    notice:
      `Powered by Smart Refill. You are receiving this email because you have an order or account with ${name}. ` +
      "If you have questions about this order, contact the station directly.",
  });
}
