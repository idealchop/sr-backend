import type { SupportKnowledgeEntry } from "./support-knowledge-types";

/** Water science knowledge for River AI water expert role. */
export const SUPPORT_WATER_SCIENCE_KNOWLEDGE = `
## Water science (owner-facing, practical)

### TDS (total dissolved solids)
- Measures dissolved minerals/salts in mg/L (ppm). **Not** bacteria count.
- RO product often 10–50 ppm depending on design; mineral/alkaline products higher by design.
- Trend matters more than one reading — rising product TDS often means membrane or carbon issue.

### pH & alkalinity
- pH 6.5–8.5 common for drinking; alkaline marketing often targets pH 8–9 with added minerals.
- Alkalinity buffers pH — explain to suki as "stability" not magic health claims. Avoid medical promises.

### Purified vs mineral vs alkaline
- **Purified:** low TDS, RO/DI based — neutral taste, good for ice and baby formula (still follow suki preference).
- **Mineral:** re-mineralized for taste; TDS mid-range.
- **Alkaline:** elevated pH; suki may prefer for taste — document your process consistently.

### Microbiological safety
- UV + proper RO + good hygiene reduces risk; storage and gallon handling matter as much as treatment.
- Biofilm: regular line/tank sanitation; don't leave stagnant loops unused for weeks.

### Container hygiene (customer gallons)
- Exterior wash vs sanitizing neck/dispense contact — train riders and counter staff.
- Damaged caps/gaskets → cross-contamination risk; flag on collection.

### Customer communication
- If TDS spike: explain maintenance action taken; avoid blaming suki containers without evidence.
- Use plant TDS logs from Smart Refill when available — never invent readings.
`;

export const SUPPORT_WATER_SCIENCE_FAQ: SupportKnowledgeEntry[] = [
  {
    id: "tds-meaning",
    topic: "Ano ang TDS at bakit importante",
    content:
      "TDS = dissolved minerals/salts in water (ppm). It does not measure bacteria. " +
      "Track product TDS over time; sudden rises often mean filters or membrane need service.",
  },
  {
    id: "alkaline-vs-purified",
    topic: "Alkaline vs purified — paano ipaliwanag sa suki",
    content:
      "Purified: low TDS, RO-based. Alkaline: higher pH, often remineralized. " +
      "Focus on taste and your consistent process — avoid health cure claims.",
  },
  {
    id: "biofilm-prevention",
    topic: "Biofilm at storage hygiene",
    content:
      "Stagnant lines/tanks + warmth grow biofilm. Flush idle loops, sanitize tanks on schedule, " +
      "and keep dispensing areas dry and clean.",
  },
];
