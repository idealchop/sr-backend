export type ProductComponent = {
  inventoryItemId: string;
  quantity: number;
};

/** Sold as-is deducts one warehouse item. Bundle deducts several. Service has no stock line. */
export type ProductKind = "stock" | "bundle" | "service";

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
  kind?: ProductKind;
  /** Shared label for sizes, such as Purified bottle. */
  family?: string;
  /** Size or variant, such as 500 ml. */
  variantLabel?: string;
  /** Warehouse item a service product adds to what the customer holds. */
  containerItemId?: string;
  /** Warehouse item this sold-as-is product was created from. */
  sourceInventoryItemId?: string;
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
  kind?: unknown;
  family?: unknown;
  variantLabel?: unknown;
  containerItemId?: unknown;
  sourceInventoryItemId?: unknown;
  components?: unknown;
  legacyWaterName?: unknown;
  sortOrder?: unknown;
};
