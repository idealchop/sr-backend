export type ProductComponent = {
  inventoryItemId: string;
  quantity: number;
};

export type DeliveryProduct = {
  id: string;
  name: string;
  unitPrice: number;
  active: boolean;
  showInCustomerOrder: boolean;
  /** Station-wide default pick for QR / Record order when the suki has no preferred products. */
  defaultForOrder: boolean;
  itemOnly: boolean;
  iconId?: string;
  components: ProductComponent[];
  legacyWaterName?: string;
  sortOrder?: number;
  createdAt?: unknown;
  updatedAt?: unknown;
};

export type WaterTypeRow = {
  water: string;
  price: number;
  iconId?: string;
};

export type ProductWriteInput = {
  name?: unknown;
  unitPrice?: unknown;
  active?: unknown;
  showInCustomerOrder?: unknown;
  defaultForOrder?: unknown;
  itemOnly?: unknown;
  iconId?: unknown;
  components?: unknown;
  legacyWaterName?: unknown;
  sortOrder?: unknown;
};
