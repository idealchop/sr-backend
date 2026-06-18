import { db, FieldValue } from "../../config/firebase-admin";

export type IotDeviceType = "tds_sensor" | "tank_level" | "flow_meter" | "generic";

export type IotDeviceRecord = {
  id: string;
  name: string;
  deviceType: IotDeviceType;
  serialNumber?: string;
  locationTag?: string;
  active: boolean;
  lastSeenAt?: string;
  createdAt: string;
};

export type IotTelemetryReading = {
  id: string;
  deviceId: string;
  recordedAt: string;
  payload: Record<string, unknown>;
};

const PARTNER_HARDWARE_KIT: Array<Omit<IotDeviceRecord, "id" | "createdAt">> = [
  { name: "Product TDS probe", deviceType: "tds_sensor", locationTag: "product", active: false },
  { name: "Product tank level", deviceType: "tank_level", locationTag: "product", active: false },
  { name: "Production flow meter", deviceType: "flow_meter", locationTag: "product", active: false },
];

/** MP-20 / MP-25 — IoT device registry + partner hardware kit seeds. */
export class IotDeviceRegistryService {
  static devicesCol(businessId: string) {
    return db.collection("businesses").doc(businessId).collection("iot_devices");
  }

  static telemetryCol(businessId: string, deviceId: string) {
    return this.devicesCol(businessId).doc(deviceId).collection("telemetry");
  }

  static async list(businessId: string): Promise<IotDeviceRecord[]> {
    const snap = await this.devicesCol(businessId).get();
    if (snap.empty) {
      await this.seedPartnerKit(businessId);
      const seeded = await this.devicesCol(businessId).get();
      return seeded.docs.map((doc) => this.serializeDevice(doc.id, doc.data()));
    }
    return snap.docs.map((doc) => this.serializeDevice(doc.id, doc.data()));
  }

  static serializeDevice(id: string, data: FirebaseFirestore.DocumentData): IotDeviceRecord {
    const createdAt = data.createdAt?.toDate ?
      data.createdAt.toDate().toISOString() :
      String(data.createdAt || "");
    const lastSeenAt = data.lastSeenAt?.toDate ?
      data.lastSeenAt.toDate().toISOString() :
      data.lastSeenAt ? String(data.lastSeenAt) : undefined;
    return {
      id,
      name: String(data.name || "Device"),
      deviceType: (data.deviceType || "generic") as IotDeviceType,
      serialNumber: data.serialNumber ? String(data.serialNumber) : undefined,
      locationTag: data.locationTag ? String(data.locationTag) : undefined,
      active: data.active !== false,
      lastSeenAt,
      createdAt,
    };
  }

  static async seedPartnerKit(businessId: string): Promise<void> {
    const batch = db.batch();
    const now = FieldValue.serverTimestamp();
    for (const seed of PARTNER_HARDWARE_KIT) {
      const ref = this.devicesCol(businessId).doc();
      batch.set(ref, { ...seed, createdAt: now, updatedAt: now });
    }
    await batch.commit();
  }

  static async create(
    businessId: string,
    input: {
      name: string;
      deviceType: IotDeviceType;
      serialNumber?: string;
      locationTag?: string;
      active?: boolean;
    },
  ): Promise<IotDeviceRecord> {
    const name = input.name.trim();
    if (!name) throw new Error("Device name is required");

    const now = FieldValue.serverTimestamp();
    const doc = {
      name: name.slice(0, 120),
      deviceType: input.deviceType,
      ...(input.serialNumber ? { serialNumber: input.serialNumber.slice(0, 64) } : {}),
      ...(input.locationTag ? { locationTag: input.locationTag.slice(0, 40) } : {}),
      active: input.active !== false,
      createdAt: now,
      updatedAt: now,
    };
    const ref = await this.devicesCol(businessId).add(doc);
    return this.serializeDevice(ref.id, { ...doc, createdAt: new Date() });
  }

  static async update(
    businessId: string,
    deviceId: string,
    patch: {
      name?: string;
      serialNumber?: string;
      locationTag?: string;
      active?: boolean;
    },
  ): Promise<IotDeviceRecord> {
    const ref = this.devicesCol(businessId).doc(deviceId);
    const snap = await ref.get();
    if (!snap.exists) throw new Error("IoT device not found");

    const updates: Record<string, unknown> = {
      updatedAt: FieldValue.serverTimestamp(),
    };
    if (patch.name !== undefined) updates.name = patch.name.trim().slice(0, 120);
    if (patch.serialNumber !== undefined) {
      updates.serialNumber = patch.serialNumber.slice(0, 64);
    }
    if (patch.locationTag !== undefined) {
      updates.locationTag = patch.locationTag.slice(0, 40);
    }
    if (patch.active !== undefined) updates.active = patch.active;

    await ref.set(updates, { merge: true });
    const next = await ref.get();
    return this.serializeDevice(deviceId, next.data() ?? {});
  }

  static async delete(businessId: string, deviceId: string): Promise<void> {
    const ref = this.devicesCol(businessId).doc(deviceId);
    const snap = await ref.get();
    if (!snap.exists) throw new Error("IoT device not found");
    await ref.delete();
  }

  static async latestTelemetryByDevices(
    businessId: string,
    deviceIds: string[],
  ): Promise<Record<string, IotTelemetryReading>> {
    const out: Record<string, IotTelemetryReading> = {};
    await Promise.all(
      deviceIds.map(async (deviceId) => {
        const snap = await this.telemetryCol(businessId, deviceId)
          .orderBy("recordedAt", "desc")
          .limit(1)
          .get();
        const doc = snap.docs[0];
        if (!doc) return;
        const d = doc.data();
        const recordedAt = d.recordedAt?.toDate ?
          d.recordedAt.toDate().toISOString() :
          String(d.recordedAt || "");
        out[deviceId] = {
          id: doc.id,
          deviceId,
          recordedAt,
          payload: (d.payload ?? {}) as Record<string, unknown>,
        };
      }),
    );
    return out;
  }

  /** Sum flow_meter gallons from telemetry in the last N days. */
  static async sumFlowGallons(businessId: string, days: number): Promise<number> {
    const devices = await this.list(businessId);
    const flowDevices = devices.filter(
      (d) => d.deviceType === "flow_meter" && d.active,
    );
    if (flowDevices.length === 0) return 0;

    const since = new Date();
    since.setDate(since.getDate() - days);
    let total = 0;

    for (const device of flowDevices) {
      const snap = await this.telemetryCol(businessId, device.id)
        .where("recordedAt", ">=", since)
        .limit(500)
        .get();
      for (const doc of snap.docs) {
        const payload = doc.data().payload ?? {};
        const gallons = Number(payload.gallons ?? payload.value ?? 0);
        if (Number.isFinite(gallons)) total += gallons;
      }
    }
    return total;
  }

  static async ingestTelemetry(
    businessId: string,
    deviceId: string,
    payload: Record<string, unknown>,
  ): Promise<IotTelemetryReading> {
    const deviceRef = this.devicesCol(businessId).doc(deviceId);
    const deviceSnap = await deviceRef.get();
    if (!deviceSnap.exists) throw new Error("IoT device not found");

    const recordedAt = new Date();
    const reading = {
      recordedAt,
      payload,
      createdAt: FieldValue.serverTimestamp(),
    };
    const ref = await this.telemetryCol(businessId, deviceId).add(reading);
    await deviceRef.set(
      { lastSeenAt: recordedAt, updatedAt: FieldValue.serverTimestamp() },
      { merge: true },
    );
    return {
      id: ref.id,
      deviceId,
      recordedAt: recordedAt.toISOString(),
      payload,
    };
  }
}
