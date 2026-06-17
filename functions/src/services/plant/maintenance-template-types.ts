export const DEFAULT_MAINTENANCE_TEMPLATE_SEEDS = [
  { slug: "sediment_filter", name: "Sediment filter", intervalDays: 30 },
  { slug: "carbon_block", name: "Carbon block", intervalDays: 90 },
  { slug: "ro_membrane", name: "RO membrane", intervalDays: 365 },
  { slug: "uv_lamp", name: "UV lamp", intervalDays: 365 },
  { slug: "tank_sanitation", name: "Tank sanitation", intervalDays: 14 },
  { slug: "nozzle_cleaning", name: "Nozzle cleaning", intervalDays: 7 },
] as const;

export type MaintenanceTemplateSlug = (typeof DEFAULT_MAINTENANCE_TEMPLATE_SEEDS)[number]["slug"];

export type MaintenanceTemplateStatus = "ok" | "due_soon" | "overdue";

export type MaintenanceTemplateRecord = {
  id: string;
  slug: string;
  name: string;
  intervalDays: number;
  lastCompletedAt: string | null;
  nextDueAt: string;
  status: MaintenanceTemplateStatus;
  createdAt: string;
  updatedAt: string;
};

export const MAINTENANCE_DUE_SOON_DAYS = 7;
