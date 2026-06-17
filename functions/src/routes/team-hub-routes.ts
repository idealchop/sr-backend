import express from "express";
import {
  deleteTeamInviteRow,
  deleteTeamMember,
  getTeamHub,
  patchTeamMemberStatus,
  postResendTeamInvite,
  postTeamInvite,
} from "../handlers/team-hub-handler";
import {
  deleteTeamChatMessageHandler,
  getTeamChatMessages,
  getTeamChats,
  postTeamChatMessage,
  postTeamChatMessageReaction,
  postTeamChatRead,
} from "../handlers/team-chat-handler";
import { requireBusinessOwner } from "../middleware/business-middleware";

// eslint-disable-next-line new-cap -- Express Router factory
const router = express.Router({ mergeParams: true });

router.get("/chats", getTeamChats);
router.post(
  "/chats/:conversationId/messages/:messageId/reactions",
  postTeamChatMessageReaction,
);
router.delete(
  "/chats/:conversationId/messages/:messageId",
  deleteTeamChatMessageHandler,
);
router.get("/chats/:conversationId/messages", getTeamChatMessages);
router.post("/chats/:conversationId/read", postTeamChatRead);
router.post("/chats/:peerUserId/messages", postTeamChatMessage);

router.get("/", requireBusinessOwner, getTeamHub);
router.patch("/members/:memberId", requireBusinessOwner, patchTeamMemberStatus);
router.delete("/members/:memberId", requireBusinessOwner, deleteTeamMember);
router.post("/invites", requireBusinessOwner, postTeamInvite);
router.post(
  "/invites/:inviteId/resend",
  requireBusinessOwner,
  postResendTeamInvite,
);
router.delete("/invites/:inviteId", requireBusinessOwner, deleteTeamInviteRow);

export default router;
