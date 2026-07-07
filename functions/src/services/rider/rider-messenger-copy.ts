import { resolveAppBaseUrlForEmail } from "../../utils/app-base-url";
import { buildRiderMessengerReasonListMessage } from "./rider-messenger-status-reasons-service";

/** Public static guide — riders open from Messenger HELP link (no login). */
export const RIDER_MESSENGER_GUIDE_PATH = "/guides/rider-messenger-user-guide.html";

export function resolveRiderMessengerGuideUrl(appBaseUrl?: string): string {
  const base = resolveAppBaseUrlForEmail(appBaseUrl).replace(/\/$/, "");
  return `${base}${RIDER_MESSENGER_GUIDE_PATH}`;
}

/** Short HELP reply in Messenger + link to full command guide. */
export function buildRiderMessengerHelpText(appBaseUrl?: string): string {
  const guideUrl = resolveRiderMessengerGuideUrl(appBaseUrl);
  return [
    "Madalas gamitin:",
    "LINK RDR-XXXX — connect (once, galing sa owner)",
    "JOBS — listahan ngayong araw",
    "START # — papunta na (in-transit)",
    "DONE # — tapos na · DONE # CASH 150 — may cash",
    "FAIL # / CANCEL # — sabay REASON # o free text",
    "REPORT # — collection report",
    "CHAT — usap sa owner · CLOSE CHAT — tapusin",
    "HELP — menu na ito",
    "",
    "Proof: send picture na may caption DONE #",
    "",
    `Buong command guide: ${guideUrl}`,
  ].join("\n");
}

export const RIDER_MESSENGER_UNLINKED_HELP =
  "I-send ang LINK code mula sa owner mo.\nHal: LINK RDR-7K2M\n(Gamitin ang same Messenger Page ng customers.)";

export function buildRiderMessengerLinkSuccessMessage(appBaseUrl?: string): string {
  const guideUrl = resolveRiderMessengerGuideUrl(appBaseUrl);
  return [
    "✅ Connected na!",
    "I-send ang JOBS para makita ang listahan ngayong araw.",
    "",
    `Command guide: ${guideUrl}`,
  ].join("\n");
}

export function buildRiderMessengerJobsEmptyMessage(): string {
  return "Walang job ngayong araw. I-send ang JOBS anytime para i-refresh.";
}

export function buildRiderMessengerJobNotFoundMessage(): string {
  return "Hindi mahanap ang job. I-send muna ang JOBS, tapos gamitin ang number.";
}

export function buildRiderMessengerInTransitMessage(params: {
  customerName: string;
  referenceId: string;
  phone?: string;
}): string {
  const phoneLine = params.phone ? `\n📞 ${params.phone}` : "";
  return `🚚 Papunta na: ${params.customerName} (${params.referenceId})${phoneLine}`;
}

export function buildRiderMessengerConfirmDoneMessage(params: {
  customerName: string;
  referenceId: string;
  cashAmount?: number;
}): string {
  const cashLine =
    params.cashAmount != null && params.cashAmount > 0 ?
      `\nCash: ₱${params.cashAmount.toLocaleString("en-PH")}` :
      "";
  return `Mark as TAPOS na ang ${params.customerName} (${params.referenceId})?${cashLine}`;
}

export function buildRiderMessengerCompletedMessage(): string {
  return "✅ Tapos na! I-send ang JOBS para i-refresh.";
}

export function buildRiderMessengerReasonPrompt(params: {
  targetStatus: "failed" | "cancelled";
  referenceId: string;
}): string {
  return buildRiderMessengerReasonListMessage(params);
}

export function buildRiderMessengerReportStartMessage(params: {
  itemName: string;
  index: number;
  total: number;
  qtyExpected?: number;
  singleContainer?: boolean;
  allItemNames?: string[];
}): string {
  const expectedLine =
    params.qtyExpected != null && params.qtyExpected > 0 ?
      `Expected: ${params.qtyExpected} ${params.itemName}` :
      params.itemName;
  const lines: string[] = [
    `Collection report (${params.index}/${params.total})`,
    "",
    expectedLine,
    "",
  ];

  if (params.total > 1 && params.allItemNames?.length) {
    lines.push("Containers sa order:");
    params.allItemNames.forEach((name, idx) => {
      lines.push(`${idx + 1}. ${name}`);
    });
    lines.push("");
    lines.push(
      params.singleContainer ?
        "Isang container type lang — pwede 'kulang ng lima' without naming." :
        "Ibang container: i-name sa reply (hal. round kulang ng lima).",
    );
    lines.push("");
  } else if (params.singleContainer) {
    lines.push("Isang container lang — pwede 'kulang ng lima' o 'may 1 sira' directly.");
    lines.push("");
  }

  lines.push(
    "I-reply ang qty:",
    "• 5 o O:5 / G:5 / OK:5",
    "• GOOD: 4 M:1 D:0",
    "• kulang ng lima · may 1 sira",
    "• round kulang ng lima (kung maraming container)",
  );
  return lines.join("\n");
}

export function buildRiderMessengerReportSavedMessage(): string {
  return "✅ Na-save ang collection report. I-send ang JOBS para i-refresh.";
}
