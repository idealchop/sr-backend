export type MaintenanceConsumableLink = {
  itemNameHint: string;
  qty: number;
};

export type MaintenanceCompleteInput = {
  userId: string;
  checklistChecked?: boolean[];
  proofUrl?: string;
  notes?: string;
  decrementConsumables?: boolean;
  expense?: {
    amount: number;
    note?: string;
  };
};

export type MaintenanceCompleteResult = {
  template: import("./maintenance-template-types").MaintenanceTemplateRecord;
  expenseId?: string;
  consumablesAdjusted: string[];
};
