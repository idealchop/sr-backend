import { describe, it, expect, vi, beforeEach } from "vitest";
import request from "supertest";
import { app } from "../../index";

vi.mock("../../middleware/auth-middleware", () => ({
  validateFirebaseIdToken: vi.fn((req: any, _res: any, next: any) => {
    req.user = { uid: "user123", email: "test@test.com", name: "Test Owner" };
    next();
  }),
}));

vi.mock("../../middleware/business-middleware", () => ({
  validateBusinessAccess: vi.fn((_req: any, _res: any, next: any) => next()),
  requireBusinessOwner: vi.fn((_req: any, _res: any, next: any) => next()),
}));

vi.mock("../../services/team/team-chat-service", () => ({
  listTeamChatDirectory: vi.fn(),
  listTeamChatMessages: vi.fn(),
  markTeamChatRead: vi.fn(),
  sendTeamChatMessage: vi.fn(),
  setTeamChatMessageReaction: vi.fn(),
  deleteTeamChatMessage: vi.fn(),
}));

vi.mock("../../config/firebase-admin", () => {
  const memberGet = vi.fn().mockResolvedValue({
    data: () => ({ name: "Test Owner" }),
  });
  const businessGet = vi.fn().mockResolvedValue({
    data: () => ({ name: "Mock Business", ownerId: "user123" }),
  });

  return {
    db: {
      collection: vi.fn(() => ({
        doc: vi.fn(() => ({
          get: businessGet,
          collection: vi.fn(() => ({
            doc: vi.fn(() => ({ get: memberGet })),
          })),
        })),
      })),
    },
  };
});

vi.mock("../../services/observability/logging/logger", () => ({
  logger: { info: vi.fn(), error: vi.fn(), warn: vi.fn() },
  logAuditEvent: vi.fn().mockResolvedValue({}),
}));

import {
  deleteTeamChatMessage,
  listTeamChatDirectory,
  listTeamChatMessages,
  markTeamChatRead,
  sendTeamChatMessage,
  setTeamChatMessageReaction,
} from "../../services/team/team-chat-service";

describe("Team Chat API Endpoints", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe("GET /business/:businessId/team/chats", () => {
    it("returns directory with retentionDays", async () => {
      (listTeamChatDirectory as any).mockResolvedValue({
        conversations: [],
        totalUnreadCount: 0,
        retentionDays: 7,
      });

      const res = await request(app).get("/business/test-biz/team/chats");

      expect(res.status).toBe(200);
      expect(res.body.data.retentionDays).toBe(7);
    });
  });

  describe("GET /business/:businessId/team/chats/:conversationId/messages", () => {
    it("returns messages for a conversation", async () => {
      (listTeamChatMessages as any).mockResolvedValue([
        {
          id: "m1",
          senderId: "user123",
          senderName: "Test Owner",
          text: "Hello",
          createdAt: "2026-06-02T08:00:00.000Z",
        },
      ]);

      const res = await request(app).get(
        "/business/test-biz/team/chats/peerA_peerB/messages",
      );

      expect(res.status).toBe(200);
      expect(res.body.data.messages).toHaveLength(1);
    });
  });

  describe("POST /business/:businessId/team/chats/:conversationId/read", () => {
    it("marks a conversation read", async () => {
      (markTeamChatRead as any).mockResolvedValue(undefined);

      const res = await request(app).post(
        "/business/test-biz/team/chats/peerA_peerB/read",
      );

      expect(res.status).toBe(200);
      expect(markTeamChatRead).toHaveBeenCalledWith(
        "test-biz",
        "user123",
        "peerA_peerB",
      );
    });
  });

  describe("POST /business/:businessId/team/chats/:peerUserId/messages", () => {
    it("sends a direct message", async () => {
      (sendTeamChatMessage as any).mockResolvedValue({
        conversationId: "peerA_peerB",
        message: {
          id: "m1",
          senderId: "user123",
          senderName: "Test Owner",
          text: "Hi",
          createdAt: "2026-06-02T08:00:00.000Z",
        },
      });

      const res = await request(app)
        .post("/business/test-biz/team/chats/peerB/messages")
        .send({ text: "Hi" });

      expect(res.status).toBe(200);
      expect(res.body.data.conversationId).toBe("peerA_peerB");
    });
  });

  describe(
    "POST /business/:businessId/team/chats/:conversationId/messages/:messageId/reactions",
    () => {
      it("sets a reaction on a message", async () => {
        (setTeamChatMessageReaction as any).mockResolvedValue({
          id: "m1",
          senderId: "user123",
          senderName: "Test Owner",
          text: "Hi",
          createdAt: "2026-06-02T08:00:00.000Z",
          reactions: { heart: ["user123"] },
        });

        const res = await request(app)
          .post("/business/test-biz/team/chats/peerA_peerB/messages/m1/reactions")
          .send({ reaction: "heart" });

        expect(res.status).toBe(200);
        expect(setTeamChatMessageReaction).toHaveBeenCalled();
      });

      it("rejects invalid reaction types", async () => {
        const res = await request(app)
          .post("/business/test-biz/team/chats/peerA_peerB/messages/m1/reactions")
          .send({ reaction: "love" });

        expect(res.status).toBe(400);
        expect(setTeamChatMessageReaction).not.toHaveBeenCalled();
      });
    },
  );

  describe(
    "DELETE /business/:businessId/team/chats/:conversationId/messages/:messageId",
    () => {
      it("deletes a message", async () => {
        (deleteTeamChatMessage as any).mockResolvedValue(undefined);

        const res = await request(app).delete(
          "/business/test-biz/team/chats/peerA_peerB/messages/m1",
        );

        expect(res.status).toBe(200);
        expect(deleteTeamChatMessage).toHaveBeenCalledWith({
          businessId: "test-biz",
          userId: "user123",
          conversationId: "peerA_peerB",
          messageId: "m1",
        });
      });
    },
  );
});
