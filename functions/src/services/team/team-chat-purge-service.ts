import { Timestamp } from "firebase-admin/firestore";
import { db } from "../../config/firebase-admin";
import { logger } from "../observability/logging/logger";
import { refreshConversationPreview } from "./team-chat-service";
import { teamChatRetentionCutoffDate } from "./team-chat-retention";

const TEAM_CHATS = "team_chats";
const MESSAGES = "messages";
const BUSINESS_PAGE_SIZE = 25;
const MESSAGE_DELETE_BATCH = 400;

export type TeamChatPurgeBatchResult = {
  messagesDeleted: number;
  conversationsDeleted: number;
  businessesScanned: number;
};

async function purgeExpiredMessagesInConversation(
  chatRef: FirebaseFirestore.DocumentReference,
  cutoff: Timestamp,
): Promise<{ messagesDeleted: number; conversationDeleted: boolean }> {
  let messagesDeleted = 0;

  for (let pass = 0; pass < 20; pass++) {
    const expiredSnap = await chatRef
      .collection(MESSAGES)
      .where("createdAt", "<=", cutoff)
      .limit(MESSAGE_DELETE_BATCH)
      .get();
    if (expiredSnap.empty) break;

    const batch = db.batch();
    for (const doc of expiredSnap.docs) {
      batch.delete(doc.ref);
    }
    await batch.commit();
    messagesDeleted += expiredSnap.size;
    if (expiredSnap.size < MESSAGE_DELETE_BATCH) break;
  }

  if (messagesDeleted === 0) {
    return { messagesDeleted: 0, conversationDeleted: false };
  }

  const remainingSnap = await chatRef.collection(MESSAGES).limit(1).get();
  if (remainingSnap.empty) {
    await chatRef.delete();
    return { messagesDeleted, conversationDeleted: true };
  }

  await refreshConversationPreview(chatRef);
  return { messagesDeleted, conversationDeleted: false };
}

/**
 * Deletes team chat messages older than the retention window and removes
 * empty conversation documents. Paginates through all businesses.
 */
export async function purgeExpiredTeamChatContent(): Promise<TeamChatPurgeBatchResult> {
  const cutoff = Timestamp.fromDate(teamChatRetentionCutoffDate());
  let messagesDeleted = 0;
  let conversationsDeleted = 0;
  let businessesScanned = 0;
  let lastBusinessId: string | undefined;
  let hasMoreBusinesses = true;

  while (hasMoreBusinesses) {
    let businessQuery = db
      .collection("businesses")
      .orderBy("__name__")
      .limit(BUSINESS_PAGE_SIZE);
    if (lastBusinessId) {
      businessQuery = businessQuery.startAfter(lastBusinessId);
    }

    const businessesSnap = await businessQuery.get();
    if (businessesSnap.empty) {
      hasMoreBusinesses = false;
      break;
    }

    for (const businessDoc of businessesSnap.docs) {
      businessesScanned++;
      const chatsSnap = await businessDoc.ref.collection(TEAM_CHATS).get();
      for (const chatDoc of chatsSnap.docs) {
        const result = await purgeExpiredMessagesInConversation(chatDoc.ref, cutoff);
        messagesDeleted += result.messagesDeleted;
        if (result.conversationDeleted) conversationsDeleted++;
      }
    }

    lastBusinessId = businessesSnap.docs[businessesSnap.docs.length - 1]?.id;
    if (businessesSnap.size < BUSINESS_PAGE_SIZE) {
      hasMoreBusinesses = false;
    }
  }

  if (messagesDeleted > 0 || conversationsDeleted > 0) {
    logger.info("team-chat purge complete", {
      messagesDeleted,
      conversationsDeleted,
      businessesScanned,
    });
  }

  return { messagesDeleted, conversationsDeleted, businessesScanned };
}
