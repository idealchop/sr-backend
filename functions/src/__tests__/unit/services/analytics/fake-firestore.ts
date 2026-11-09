/**
 * Minimal in-memory Firestore for analytics materializer tests.
 * Supports the subset the materializer uses and counts billed reads.
 * Ordering is implemented independently of analytics-ledger-projection so the
 * "legacy" ordered queries act as an outside reference.
 */
import { Timestamp } from "firebase-admin/firestore";

type Data = Record<string, unknown>;

class Sentinel {
  constructor(public op: string, public args: unknown[] = []) {}
}

export const fakeClock = { nowMs: Date.UTC(2026, 10, 9, 4, 0, 0) };

export const FakeFieldValue = {
  serverTimestamp: () => new Sentinel("serverTimestamp"),
  increment: (n: number) => new Sentinel("increment", [n]),
  arrayUnion: (...items: unknown[]) => new Sentinel("arrayUnion", items),
  arrayRemove: (...items: unknown[]) => new Sentinel("arrayRemove", items),
  delete: () => new Sentinel("delete"),
};

export const readCounter = { reads: 0, writes: 0 };

const store = new Map<string, Data>();

export function resetFakeFirestore(): void {
  store.clear();
  readCounter.reads = 0;
  readCounter.writes = 0;
}

export function cloneStore(): Map<string, Data> {
  const out = new Map<string, Data>();
  for (const [k, v] of store) out.set(k, { ...v });
  return out;
}

export function restoreStore(snapshot: Map<string, Data>): void {
  store.clear();
  for (const [k, v] of snapshot) store.set(k, { ...v });
}

export function rawDoc(path: string): Data | undefined {
  return store.get(path);
}

export function listDocs(collectionPath: string): { id: string; data: Data }[] {
  const prefix = `${collectionPath}/`;
  const out: { id: string; data: Data }[] = [];
  for (const [path, data] of store) {
    if (!path.startsWith(prefix)) continue;
    const rest = path.slice(prefix.length);
    if (rest.includes("/")) continue;
    out.push({ id: rest, data });
  }
  return out;
}

/** Firestore stores JS Dates as Timestamps (top-level and nested). */
function normalize(value: unknown): unknown {
  if (value instanceof Date) return Timestamp.fromDate(value);
  if (Array.isArray(value)) return value.map(normalize);
  if (value && typeof value === "object" && Object.getPrototypeOf(value) === Object.prototype) {
    const out: Data = {};
    for (const [k, v] of Object.entries(value)) if (v !== undefined) out[k] = normalize(v);
    return out;
  }
  return value;
}

function applyWrite(path: string, data: Data, merge: boolean): void {
  readCounter.writes += 1;
  const prev = merge ? { ...(store.get(path) ?? {}) } : {};
  for (const [key, value] of Object.entries(data)) {
    if (value === undefined) continue;
    if (value instanceof Sentinel) {
      switch (value.op) {
      case "serverTimestamp":
        prev[key] = Timestamp.fromMillis(fakeClock.nowMs);
        break;
      case "increment":
        prev[key] = (Number(prev[key]) || 0) + Number(value.args[0]);
        break;
      case "arrayUnion": {
        const arr = Array.isArray(prev[key]) ? [...(prev[key] as unknown[])] : [];
        for (const item of value.args) if (!arr.includes(item)) arr.push(item);
        prev[key] = arr;
        break;
      }
      case "arrayRemove": {
        const arr = Array.isArray(prev[key]) ? (prev[key] as unknown[]) : [];
        prev[key] = arr.filter((item) => !value.args.includes(item));
        break;
      }
      case "delete":
        delete prev[key];
        break;
      default:
        throw new Error(`unknown sentinel ${value.op}`);
      }
      continue;
    }
    prev[key] = normalize(value);
  }
  store.set(path, prev);
}

class DocSnap {
  constructor(public id: string, public ref: DocRef, private value: Data | undefined) {}
  get exists(): boolean {
    return this.value !== undefined;
  }
  data(): Data | undefined {
    return this.value ? { ...this.value } : undefined;
  }
}

class DocRef {
  constructor(public path: string) {}
  get id(): string {
    return this.path.split("/").pop() as string;
  }
  collection(name: string): Query {
    return new Query(`${this.path}/${name}`);
  }
  async get(): Promise<DocSnap> {
    readCounter.reads += 1;
    return new DocSnap(this.id, this, store.get(this.path));
  }
  async set(data: Data, opts?: { merge?: boolean }): Promise<void> {
    applyWrite(this.path, data, Boolean(opts?.merge));
  }
  async update(data: Data): Promise<void> {
    if (!store.has(this.path)) throw new Error(`no doc ${this.path}`);
    applyWrite(this.path, data, true);
  }
  async delete(): Promise<void> {
    readCounter.writes += 1;
    store.delete(this.path);
  }
}

// Independent reference ordering: null < number < timestamp < string.
function rank(v: unknown): number {
  if (v === null) return 0;
  if (typeof v === "boolean") return 1;
  if (typeof v === "number") return 2;
  if (v instanceof Timestamp) return 3;
  if (typeof v === "string") return 4;
  return 9;
}

function cmp(a: unknown, b: unknown): number {
  const ra = rank(a);
  const rb = rank(b);
  if (ra !== rb) return ra - rb;
  if (a instanceof Timestamp && b instanceof Timestamp) {
    return a.seconds - b.seconds || a.nanoseconds - b.nanoseconds;
  }
  if (typeof a === "number" && typeof b === "number") return a - b;
  if (typeof a === "string" && typeof b === "string") return a < b ? -1 : a > b ? 1 : 0;
  if (typeof a === "boolean" && typeof b === "boolean") return Number(a) - Number(b);
  return 0;
}

type Filter = { field: string; op: string; value: unknown };

class Query {
  constructor(
    public path: string,
    private filters: Filter[] = [],
    private orders: { field: string; dir: "asc" | "desc" }[] = [],
    private max: number | null = null,
    private after: DocSnap | null = null,
  ) {}
  doc(id: string): DocRef {
    return new DocRef(`${this.path}/${id}`);
  }
  where(field: string, op: string, value: unknown): Query {
    const filters = [...this.filters, { field, op, value }];
    return new Query(this.path, filters, this.orders, this.max, this.after);
  }
  orderBy(field: string, dir: "asc" | "desc" = "asc"): Query {
    const orders = [...this.orders, { field, dir }];
    return new Query(this.path, this.filters, orders, this.max, this.after);
  }
  limit(n: number): Query {
    return new Query(this.path, this.filters, this.orders, n, this.after);
  }
  startAfter(snap: DocSnap): Query {
    return new Query(this.path, this.filters, this.orders, this.max, snap);
  }
  private matching(): { id: string; data: Data }[] {
    let docs = listDocs(this.path);
    for (const f of this.filters) {
      docs = docs.filter(({ data }) => {
        if (!(f.field in data)) return false;
        const v = data[f.field];
        if (f.op === "==") return cmp(v, f.value) === 0 && rank(v) === rank(f.value);
        if (f.op === "!=") return !(v === null && f.value === null) && cmp(v, f.value) !== 0;
        if (rank(v) !== rank(f.value)) return false;
        if (f.op === ">=") return cmp(v, f.value) >= 0;
        if (f.op === "<=") return cmp(v, f.value) <= 0;
        if (f.op === ">") return cmp(v, f.value) > 0;
        throw new Error(`op ${f.op}`);
      });
    }
    const orders = [...this.orders];
    for (const o of orders) docs = docs.filter(({ data }) => o.field in data);
    const lastDir = orders.length ? orders[orders.length - 1].dir : "asc";
    docs.sort((a, b) => {
      for (const o of orders) {
        const c = cmp(a.data[o.field], b.data[o.field]);
        if (c !== 0) return o.dir === "asc" ? c : -c;
      }
      const c = a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
      return lastDir === "asc" ? c : -c;
    });
    if (this.after) {
      const idx = docs.findIndex((d) => d.id === this.after?.id);
      docs = idx >= 0 ? docs.slice(idx + 1) : docs;
    }
    if (this.max != null) docs = docs.slice(0, this.max);
    return docs;
  }
  async get(): Promise<{ docs: DocSnap[]; size: number; empty: boolean }> {
    const docs = this.matching();
    readCounter.reads += Math.max(1, docs.length);
    const snaps = docs.map(
      (d) => new DocSnap(d.id, new DocRef(`${this.path}/${d.id}`), { ...d.data }),
    );
    return { docs: snaps, size: snaps.length, empty: snaps.length === 0 };
  }
  count(): { get: () => Promise<{ data: () => { count: number } }> } {
    return {
      get: async () => {
        const n = this.matching().length;
        readCounter.reads += Math.max(1, Math.ceil(n / 1000));
        return { data: () => ({ count: n }) };
      },
    };
  }
}

export const fakeDb = {
  collection: (name: string) => new Query(name),
  async getAll(...refs: DocRef[]): Promise<DocSnap[]> {
    readCounter.reads += refs.length;
    return refs.map((ref) => new DocSnap(ref.id, ref, store.get(ref.path)));
  },
  bulkWriter() {
    const ops: (() => void)[] = [];
    return {
      set(ref: DocRef, data: Data, opts?: { merge?: boolean }) {
        ops.push(() => applyWrite(ref.path, data, Boolean(opts?.merge)));
      },
      async close() {
        for (const op of ops) op();
      },
    };
  },
  async runTransaction<T>(fn: (t: {
    get: (ref: DocRef) => Promise<DocSnap>;
    set: (ref: DocRef, data: Data, opts?: { merge?: boolean }) => void;
  }) => Promise<T>): Promise<T> {
    const ops: (() => void)[] = [];
    const result = await fn({
      get: (ref) => ref.get(),
      set: (ref, data, opts) => {
        ops.push(() => applyWrite(ref.path, data, Boolean(opts?.merge)));
      },
    });
    for (const op of ops) op();
    return result;
  },
};

export const ts = (ms: number) => Timestamp.fromMillis(ms);
export { Timestamp };
