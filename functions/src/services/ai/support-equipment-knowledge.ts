import type { SupportKnowledgeEntry } from "./support-knowledge-types";

/** Equipment & maintenance knowledge for River AI technician role. */
export const SUPPORT_EQUIPMENT_KNOWLEDGE = `
## Equipment & maintenance (Philippines WRS)

### RO (reverse osmosis)
- Typical chain: sediment → carbon → RO membrane → post-carbon → UV (optional).
- **Low output / slow refill:** check inlet pressure, clogged sediment/carbon, full storage tank (check tank pressure ~7–10 psi when empty line), closed valves.
- **High TDS after RO:** membrane age/fouling, insufficient flush, bypass valve leak — plan membrane replacement per manufacturer hours/TDS trend.
- **Membrane preservation:** flush after idle periods; avoid chlorine hitting RO membrane (carbon stage must work).

### UV sterilizer
- Lamp life ~8,000–12,000 hours (varies by unit) — dim glow or age means replace lamp and clean quartz sleeve.
- Water must be clear (low turbidity) for UV to work; pre-filters matter.

### Sediment & carbon filters
- Sediment: replace when ΔP rises or schedule (often 1–3 months by water quality).
- Carbon: chlorine taste breakthrough or schedule (3–6 months). Channeling if water finds paths — replace on schedule not only by taste.

### Pumps & pressure
- Booster pump short-cycling: tank air charge, leak, stuck check valve.
- Loud pump: cavitation (air leak on suction), worn bearings.

### Storage & dispensing
- Tank sanitation: periodic disinfect per SOP; avoid algae (opaque tanks, no direct sun).
- Faucet/dispensing area: daily wipe; separate dirty gallon exterior from product water contact.

### Preventive maintenance (PM)
- Log filter changes, UV lamp, membrane, pump service in Smart Refill plant/production modules when enabled.
- Photo PM (filter housing) helps prove diligence to suki and inspectors.

### When to call a licensed tech
- Electrical panel issues, persistent leaks inside electrical enclosures, structural plumbing mods.
`;

export const SUPPORT_EQUIPMENT_FAQ: SupportKnowledgeEntry[] = [
  {
    id: "ro-high-tds",
    topic: "Mataas ang TDS pagkatapos ng RO",
    content:
      "Check sediment/carbon stages, membrane age, flush routine, and bypass valves. " +
      "Compare product vs source TDS with a calibrated meter. Plan membrane replacement if trend is up week over week.",
  },
  {
    id: "uv-lamp-replace",
    topic: "Kailan palitan ang UV lamp",
    content:
      "Follow manufacturer hours (often 8k–12k). Replace lamp and clean quartz sleeve together. " +
      "If suki complain about taste/odor despite RO, UV alone will not fix carbon exhaustion.",
  },
  {
    id: "pump-no-pressure",
    topic: "Mahina ang pressure ng pump",
    content:
      "Check inlet supply, air in lines, clogged pre-filters, tank air bladder pressure, and check valve. " +
      "Listen for cavitation — often a suction-side leak.",
  },
  {
    id: "filter-change-schedule",
    topic: "Filter change schedule basics",
    content:
      "Sediment: 1–3 months or high ΔP. Carbon: 3–6 months or chlorine breakthrough. " +
      "RO membrane: manufacturer TDS/gallon guidelines. Log every change in your PM logbook.",
  },
];
