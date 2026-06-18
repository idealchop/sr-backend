import type { MaintenanceTemplateSlug } from "./maintenance-template-types";
import type { MaintenanceConsumableLink } from "./maintenance-complete-types";

/** MP-06 — suggested consumable links when templates are seeded. */
export const DEFAULT_TEMPLATE_CONSUMES: Partial<
  Record<MaintenanceTemplateSlug, MaintenanceConsumableLink[]>
> = {
  sediment_filter: [{ itemNameHint: "sediment", qty: 1 }],
  carbon_block: [{ itemNameHint: "carbon", qty: 1 }],
  ro_membrane: [{ itemNameHint: "membrane", qty: 1 }],
  uv_lamp: [{ itemNameHint: "uv", qty: 1 }],
  tank_sanitation: [{ itemNameHint: "sanitizer", qty: 1 }],
  nozzle_cleaning: [{ itemNameHint: "nozzle", qty: 1 }],
};

export function defaultConsumesForSlug(slug: string): MaintenanceConsumableLink[] {
  const key = slug as MaintenanceTemplateSlug;
  return DEFAULT_TEMPLATE_CONSUMES[key] ?? [];
}
