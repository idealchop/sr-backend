import { db, FieldValue } from "../../config/firebase-admin";
import { logger } from "../observability/logging/logger";
import { InventoryService } from "../inventory/inventory-service";
import type { DeliveryProduct, ProductWriteInput } from "./product-types";
import {
  derivedWaterTypesFromProducts,
  duplicateNameExists,
  otherDefaultProductIds,
  parseProductWrite,
  ProductValidationError,
  seedProductsFromWaterTypes,
  serializeProduct,
} from "./product-catalog";
import { DEFAULT_PRODUCT_ICON_ID } from "./product-icon-catalog";

const PRODUCTS = "products";

export { ProductValidationError };

export class ProductService {
  static collection(businessId: string) {
    return db.collection("businesses").doc(businessId).collection(PRODUCTS);
  }

  static async listItems(businessId: string): Promise<DeliveryProduct[]> {
    let snapshot;
    try {
      snapshot = await this.collection(businessId).orderBy("sortOrder", "asc").get();
    } catch {
      snapshot = await this.collection(businessId).get();
    }

    const items = snapshot.docs.map((doc) => serializeProduct(doc.id, doc.data()));
    items.sort((a, b) => (a.sortOrder ?? 0) - (b.sortOrder ?? 0) || a.name.localeCompare(b.name));
    return items;
  }

  static async getItem(
    businessId: string,
    productId: string,
  ): Promise<DeliveryProduct | null> {
    const doc = await this.collection(businessId).doc(productId).get();
    if (!doc.exists) return null;
    return serializeProduct(doc.id, doc.data() || {});
  }

  static async ensureSeeded(businessId: string): Promise<DeliveryProduct[]> {
    const existing = await this.listItems(businessId);
    if (existing.length > 0) return existing;

    const biz = await db.collection("businesses").doc(businessId).get();
    const seeds = seedProductsFromWaterTypes(biz.data()?.waterTypes);
    if (seeds.length === 0) return [];

    const batch = db.batch();
    const now = FieldValue.serverTimestamp();
    for (const seed of seeds) {
      const ref = this.collection(businessId).doc();
      batch.set(ref, {
        ...seed,
        createdAt: now,
        updatedAt: now,
      });
    }
    await batch.commit();
    logger.info(`Seeded ${seeds.length} products from waterTypes`, { businessId });
    return this.listItems(businessId);
  }

  static async syncDerivedWaterTypes(businessId: string): Promise<void> {
    const products = await this.listItems(businessId);
    const waterTypes = derivedWaterTypesFromProducts(products);
    await db.collection("businesses").doc(businessId).update({
      waterTypes,
      updatedAt: FieldValue.serverTimestamp(),
    });
  }

  static async assertComponentsExist(
    businessId: string,
    components: DeliveryProduct["components"],
  ): Promise<void> {
    for (const component of components) {
      const item = await InventoryService.getItem(businessId, component.inventoryItemId);
      if (!item) {
        throw new ProductValidationError(
          `Inventory item ${component.inventoryItemId} was not found.`,
        );
      }
    }
  }

  static async createItem(
    businessId: string,
    input: ProductWriteInput,
  ): Promise<string> {
    await this.ensureSeeded(businessId);
    const parsed = parseProductWrite(input, { requireName: true });
    const existing = await this.listItems(businessId);
    if (parsed.name && duplicateNameExists(existing, parsed.name)) {
      throw new ProductValidationError("A product with this name already exists.");
    }
    if (parsed.components?.length) {
      await this.assertComponentsExist(businessId, parsed.components);
    }

    const isDefault = parsed.defaultForOrder === true;
    const isActive = parsed.active !== false;
    if (isDefault && !isActive) {
      throw new ProductValidationError("Inactive products cannot be the default pick.");
    }

    const maxSort = existing.reduce((max, row) => Math.max(max, row.sortOrder ?? 0), -1);
    const ref = this.collection(businessId).doc();
    await ref.set({
      name: parsed.name,
      unitPrice: parsed.unitPrice ?? 0,
      active: isActive,
      showInCustomerOrder: parsed.showInCustomerOrder !== false,
      defaultForOrder: isDefault,
      itemOnly: parsed.itemOnly === true,
      iconId: parsed.iconId || DEFAULT_PRODUCT_ICON_ID,
      components: parsed.components ?? [],
      ...(parsed.legacyWaterName ? { legacyWaterName: parsed.legacyWaterName } : {}),
      sortOrder: parsed.sortOrder ?? maxSort + 1,
      createdAt: FieldValue.serverTimestamp(),
      updatedAt: FieldValue.serverTimestamp(),
    });
    if (isDefault) {
      await this.clearOtherDefaults(businessId, ref.id, existing);
    }
    await this.syncDerivedWaterTypes(businessId);
    return ref.id;
  }

  static async updateItem(
    businessId: string,
    productId: string,
    input: ProductWriteInput,
  ): Promise<void> {
    const current = await this.getItem(businessId, productId);
    if (!current) {
      throw new ProductValidationError("Product not found.");
    }
    const parsed = parseProductWrite(input);
    if (parsed.name) {
      const existing = await this.listItems(businessId);
      if (duplicateNameExists(existing, parsed.name, productId)) {
        throw new ProductValidationError("A product with this name already exists.");
      }
    }
    if (parsed.components) {
      await this.assertComponentsExist(businessId, parsed.components);
    }

    const nextActive = parsed.active ?? current.active;
    const wantsDefault = parsed.defaultForOrder === true;
    if (wantsDefault && nextActive === false) {
      throw new ProductValidationError("Inactive products cannot be the default pick.");
    }
    if (nextActive === false && current.defaultForOrder) {
      parsed.defaultForOrder = false;
    }

    const existing = wantsDefault ? await this.listItems(businessId) : [];
    await this.collection(businessId).doc(productId).update({
      ...parsed,
      updatedAt: FieldValue.serverTimestamp(),
    });
    if (wantsDefault) {
      await this.clearOtherDefaults(businessId, productId, existing);
    }
    await this.syncDerivedWaterTypes(businessId);
  }

  static async deleteItem(businessId: string, productId: string): Promise<DeliveryProduct> {
    const current = await this.getItem(businessId, productId);
    if (!current) {
      throw new ProductValidationError("Product not found.");
    }
    await this.collection(businessId).doc(productId).delete();
    await this.syncDerivedWaterTypes(businessId);
    return current;
  }

  private static async clearOtherDefaults(
    businessId: string,
    keepId: string,
    products: DeliveryProduct[],
  ): Promise<void> {
    const otherIds = otherDefaultProductIds(products, keepId);
    if (otherIds.length === 0) return;
    const batch = db.batch();
    const now = FieldValue.serverTimestamp();
    for (const id of otherIds) {
      batch.update(this.collection(businessId).doc(id), {
        defaultForOrder: false,
        updatedAt: now,
      });
    }
    await batch.commit();
  }
}
