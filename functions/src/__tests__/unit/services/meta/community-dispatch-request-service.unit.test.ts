import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  buildFallbackMetaMessageId,
  createCommunityDispatchRequest,
} from "../../../../services/meta/community-dispatch-request-service";
import { formatCommunityRequestReference } from "../../../../services/meta/community-dispatch-request-types";

const { runTransactionMock, docGetMock, docSetMock } = vi.hoisted(() => ({
  runTransactionMock: vi.fn(),
  docGetMock: vi.fn(),
  docSetMock: vi.fn(),
}));

vi.mock("../../../../config/firebase-admin", () => ({
  db: {
    collection: () => ({
      doc: () => ({
        get: docGetMock,
        set: docSetMock,
      }),
    }),
    runTransaction: runTransactionMock,
  },
  FieldValue: { serverTimestamp: () => "SERVER_TS" },
}));

describe("community-dispatch-request-service", () => {
  beforeEach(() => {
    runTransactionMock.mockReset();
    docGetMock.mockReset();
    docSetMock.mockReset();
  });

  it("formatCommunityRequestReference builds CR- prefix", () => {
    expect(formatCommunityRequestReference("m_abc123xyz")).toMatch(/^CR-/);
  });

  it("buildFallbackMetaMessageId is stable for same psid + message", () => {
    const a = buildFallbackMetaMessageId("psid", "hello");
    const b = buildFallbackMetaMessageId("psid", "hello");
    expect(a).toBe(b);
    expect(a.startsWith("hash_")).toBe(true);
  });

  it("creates a new dispatch request when doc is missing", async () => {
    runTransactionMock.mockImplementation(async (fn: (tx: unknown) => Promise<unknown>) => {
      const tx = {
        get: vi.fn().mockResolvedValue({ exists: false }),
        set: vi.fn(),
      };
      return fn(tx);
    });

    const result = await createCommunityDispatchRequest({
      contact: { sourceChannel: "community_messenger", contactId: "psid-1" },
      metaMessageId: "m_test123",
      rawMessage: "name: Ana",
      fields: { name: "Ana", delivery: false, qty: 2, number: "09171234567" },
      parseSource: "template",
    });

    expect(result.created).toBe(true);
    expect(result.id).toBe("m_test123");
    expect(result.referenceId).toMatch(/^CR-/);
  });

  it("returns existing doc without creating duplicate", async () => {
    runTransactionMock.mockImplementation(async (fn: (tx: unknown) => Promise<unknown>) => {
      const tx = {
        get: vi.fn().mockResolvedValue({
          exists: true,
          data: () => ({ referenceId: "CR-EXISTING" }),
        }),
        set: vi.fn(),
      };
      return fn(tx);
    });

    const result = await createCommunityDispatchRequest({
      metaPsid: "psid-1",
      metaMessageId: "m_dup",
      rawMessage: "name: Ana",
      fields: { name: "Ana", delivery: false, qty: 2, number: "09171234567" },
      parseSource: "template",
    });

    expect(result.created).toBe(false);
    expect(result.referenceId).toBe("CR-EXISTING");
  });
});
