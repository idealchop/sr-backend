export const PRODUCTION_SHIFT_VALUES = ["AM", "PM"] as const;

export type ProductionShiftPeriod = (typeof PRODUCTION_SHIFT_VALUES)[number];

export type ProductionShiftRecord = {
  id: string;
  calendarDate: string;
  shift: ProductionShiftPeriod;
  gallonsProduced: number;
  gallonsRejected: number;
  notes?: string;
  source: "manual" | "iot";
  recordedBy: string;
  createdAt: string;
  updatedAt: string;
};

export type ProductionShiftInput = {
  calendarDate: string;
  shift: ProductionShiftPeriod;
  gallonsProduced: number;
  gallonsRejected?: number;
  notes?: string;
};
