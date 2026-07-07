/** Canonical version id for the built-in Smart Refill custody template. */
export const DEFAULT_CONTAINER_CUSTODY_VERSION = "smartrefill-v1";

export type ContainerCustodySection = {
  title: string;
  paragraphs?: string[];
  bullets?: string[];
};

export function buildDefaultContainerCustodySections(
  stationName: string,
): ContainerCustodySection[] {
  const station = stationName.trim() || "the water refilling station";
  return [
    {
      title: "1. Purpose",
      paragraphs: [
        "This agreement explains how station-owned containers and related equipment " +
          "(\"WRS items\") are handled when " +
          `${station} delivers refilled water to you.`,
        "It applies to customers on WRS container rotation — not to customers who " +
          "bring their own gallon shells (BYOG / own gallon).",
      ],
    },
    {
      title: "2. WRS-owned items",
      paragraphs: [`${station} may assign standard containers and accessories such as:`],
      bullets: [
        "Round or slim refill containers (shells)",
        "Caps, seals, and dispensers/faucets supplied by the station",
        "Other catalog items marked as station-owned",
      ],
    },
    {
      title: "3. Custody and care",
      paragraphs: [
        "While WRS items are in your possession, you are responsible for their " +
          "safekeeping at your address or place of business.",
        "Loss, theft, or damage beyond normal wear may be charged at replacement " +
          "cost or deducted from any deposit, according to station policy.",
      ],
    },
    {
      title: "4. One policy per order — no mixing",
      paragraphs: [
        "Each order uses either station-owned (WRS rotation) containers or your own " +
          "gallon shells — never both on the same visit.",
        "If you are on own-gallon (BYOG) and request more refills than the containers " +
          "you have declared, the station automatically switches that order to WRS " +
          "container rotation and updates your account to WRS-provided containers.",
        "When the station enables delivery container add-ons, refills above the Round or " +
          "Slim containers you own are covered by purchasing those containers as add-ons " +
          "instead of mixing WRS rotation on the same order.",
      ],
    },
    {
      title: "5. Delivery and swap rules",
      bullets: [
        "WRS rotation customers receive station-standard kits on swap deliveries.",
        "Staff may refuse a swap if the container is the wrong type, unsafe, " +
          "unclean, incomplete, or not part of the station catalog.",
        "Water-only refill may still be offered when policy allows.",
        "BYOG customers supply their own shell; the station refills water only " +
          "and does not collect customer-owned shells.",
      ],
    },
    {
      title: "6. Collection and missing parts",
      paragraphs: [
        "On collection visits, missing or damaged WRS-owned parts may be recorded " +
          "and reconciled against this agreement and your account.",
      ],
    },
    {
      title: "7. Acceptance",
      paragraphs: [
        `By accepting this agreement, you acknowledge the custody terms of ${station} ` +
          `for WRS-owned containers (template version ${DEFAULT_CONTAINER_CUSTODY_VERSION}).`,
        "This is a one-time acknowledgment per template version. A new version " +
          "requires acceptance again if the station updates the document.",
      ],
    },
  ];
}
