import type { MaintenanceTemplateSlug } from "./maintenance-template-types";

/** MP-03 — default checklist steps per PM template slug. */
export const MAINTENANCE_CHECKLISTS: Record<
  MaintenanceTemplateSlug,
  string[]
> = {
  sediment_filter: [
    "Power off pump and close inlet valve",
    "Replace sediment cartridge / filter housing",
    "Run flush 2–3 minutes and check for leaks",
  ],
  carbon_block: [
    "Bypass or isolate carbon stage",
    "Install new carbon block cartridge",
    "Flush until water runs clear (no carbon fines)",
  ],
  ro_membrane: [
    "Depressurize RO system",
    "Replace RO membrane per manufacturer torque",
    "Run permeate flush and note TDS if available",
  ],
  uv_lamp: [
    "Power off UV chamber",
    "Replace UV lamp and clean quartz sleeve",
    "Reset runtime counter / note install date",
  ],
  tank_sanitation: [
    "Drain storage tank",
    "Sanitize interior and faucets",
    "Refill and sample product water",
  ],
  nozzle_cleaning: [
    "Wipe and sanitize fill nozzles",
    "Check drip tray and drain",
    "Spot-check fill volume on test jug",
  ],
};

export function checklistForTemplateSlug(
  slug: string,
): string[] {
  const key = slug as MaintenanceTemplateSlug;
  return MAINTENANCE_CHECKLISTS[key] ?? [
    "Complete the maintenance task per station SOP",
    "Inspect for leaks or abnormal noise",
    "Log any parts replaced",
  ];
}
