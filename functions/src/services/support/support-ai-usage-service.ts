import { db, FieldValue } from "../../config/firebase-admin";
import type {
  SupportAiChatFrequency,
  SupportAiPlanLimits,
  SupportAiUsageSnapshot,
} from "../../utils/support-ai-plan-limits";

const MANILA_TZ = "Asia/Manila";
const USAGE_COLLECTION = "private";

export class SupportAiLimitError extends Error {
  code:
    | "SUPPORT_AI_CHAT_LIMIT"
    | "SUPPORT_AI_ATTACHMENTS_NOT_ALLOWED"
    | "SUPPORT_AI_ATTACHMENT_LIMIT";

  constructor(
    code: SupportAiLimitError["code"],
    message: string,
  ) {
    super(message);
    this.name = "SupportAiLimitError";
    this.code = code;
  }
}

function manilaPeriodKey(
  frequency: SupportAiChatFrequency,
  now = new Date(),
): string {
  const formatter = new Intl.DateTimeFormat("en-CA", {
    timeZone: MANILA_TZ,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  });
  const parts = formatter.formatToParts(now);
  const y = parts.find((p) => p.type === "year")?.value ?? "1970";
  const m = parts.find((p) => p.type === "month")?.value ?? "01";
  const d = parts.find((p) => p.type === "day")?.value ?? "01";
  if (frequency === "monthly") {
    return `${frequency}_${y}-${m}`;
  }
  return `${frequency}_${y}-${m}-${d}`;
}

function usageDocRef(businessId: string, frequency: SupportAiChatFrequency) {
  const key = manilaPeriodKey(frequency);
  return db
    .collection("businesses")
    .doc(businessId)
    .collection(USAGE_COLLECTION)
    .doc(`support_ai_${key}`);
}

function attachmentFrequency(limits: SupportAiPlanLimits): SupportAiChatFrequency {
  if (limits.attachmentsMax !== null) {
    return limits.chatFrequency || "daily";
  }
  return limits.chatFrequency || "monthly";
}

export class SupportAiUsageService {
  static async readUsage(
    businessId: string,
    limits: SupportAiPlanLimits,
  ): Promise<{ chatUsed: number; attachmentsUsed: number }> {
    const chatFrequency = limits.chatFrequency;
    const attachmentFreq = attachmentFrequency(limits);

    let chatUsed = 0;
    if (chatFrequency && limits.chatMax !== null) {
      const snap = await usageDocRef(businessId, chatFrequency).get();
      chatUsed = Number(snap.data()?.chatCount) || 0;
    }

    let attachmentsUsed = 0;
    if (limits.attachmentsMax !== null) {
      const snap = await usageDocRef(businessId, attachmentFreq).get();
      attachmentsUsed = Number(snap.data()?.attachmentCount) || 0;
    }

    return { chatUsed, attachmentsUsed };
  }

  static async getUsageSnapshot(
    businessId: string,
    limits: SupportAiPlanLimits,
  ): Promise<SupportAiUsageSnapshot> {
    const { chatUsed, attachmentsUsed } = await this.readUsage(businessId, limits);
    return {
      ...limits,
      chatUsed,
      attachmentsUsed,
    };
  }

  static async assertWithinLimits(
    businessId: string,
    limits: SupportAiPlanLimits,
    newAttachmentCount: number,
  ): Promise<void> {
    const { chatUsed, attachmentsUsed } = await this.readUsage(businessId, limits);

    if (limits.chatMax !== null && chatUsed >= limits.chatMax) {
      const window = limits.chatFrequency === "daily" ? "today" : "this month";
      throw new SupportAiLimitError(
        "SUPPORT_AI_CHAT_LIMIT",
        `River AI chat limit reached for ${window}. Upgrade your plan for more support chats.`,
      );
    }

    if (newAttachmentCount > 0 && !limits.attachmentsAllowed) {
      throw new SupportAiLimitError(
        "SUPPORT_AI_ATTACHMENTS_NOT_ALLOWED",
        "Photo and video attachments are not included on your plan. Upgrade to Grow or higher.",
      );
    }

    if (
      limits.attachmentsMax !== null &&
      attachmentsUsed + newAttachmentCount > limits.attachmentsMax
    ) {
      const window = limits.chatFrequency === "daily" ? "today" : "this month";
      throw new SupportAiLimitError(
        "SUPPORT_AI_ATTACHMENT_LIMIT",
        `Attachment limit reached for ${window}. Upgrade your plan for more uploads.`,
      );
    }
  }

  static async recordTurn(
    businessId: string,
    limits: SupportAiPlanLimits,
    attachmentCount: number,
  ): Promise<void> {
    if (limits.chatMax !== null && limits.chatFrequency) {
      const ref = usageDocRef(businessId, limits.chatFrequency);
      await ref.set(
        {
          chatCount: FieldValue.increment(1),
          frequency: limits.chatFrequency,
          updatedAt: FieldValue.serverTimestamp(),
        },
        { merge: true },
      );
    }

    if (attachmentCount > 0 && limits.attachmentsAllowed) {
      const freq = attachmentFrequency(limits);
      const ref = usageDocRef(businessId, freq);
      await ref.set(
        {
          attachmentCount: FieldValue.increment(attachmentCount),
          frequency: freq,
          updatedAt: FieldValue.serverTimestamp(),
        },
        { merge: true },
      );
    }
  }
}
