import { logger } from "../observability/logging/logger";
import {
  sendMetaMessengerText,
  type SendTextResult,
} from "../meta/meta-messenger-send-service";
import { TeamMessengerLinkService } from "./team-messenger-link-service";
import {
  bridgeOwnerTextToRider,
  listRidersInChatMode,
  matchRiderChatTarget,
} from "./team-messenger-bridge-service";
import {
  ownerInitiateDeliveryChat,
  ownerReplyToDeliveryChat,
} from "../meta/delivery-messenger-chat-service";
import {
  getTeamMessengerSession,
  saveTeamMessengerSession,
} from "./team-messenger-session-service";

const TEAM_LINK_RE = /^LINK\s+TMR-/i;
const TEAM_CHAT_RE = /^(CHAT|CLOSE\s+CHAT|CLOSECHAT|HELP|MENU)(\s|$)/i;
const DELIVERY_REF_PREFIX_RE = /^(TX-|CR-)/i;

function parseTeamMessengerCommand(input: string):
  | { kind: "link"; code: string }
  | { kind: "chat_open"; target?: string }
  | { kind: "delivery_chat_open"; target: string }
  | { kind: "chat_close" }
  | { kind: "help" }
  | { kind: "unknown"; raw: string } {
  const raw = input.trim();
  if (!raw) return { kind: "unknown", raw: "" };

  const upper = raw.toUpperCase();
  if (upper === "HELP" || upper === "MENU") return { kind: "help" };

  const linkMatch = raw.match(/^LINK\s+(\S+)/i);
  if (linkMatch?.[1]) return { kind: "link", code: linkMatch[1] };

  if (upper === "CLOSE CHAT" || upper === "CLOSECHAT") {
    return { kind: "chat_close" };
  }

  const custMatch = raw.match(/^CHAT\s+(?:CUST(?:OMER)?|TO)\s+(.+)$/i);
  if (custMatch?.[1]) {
    return { kind: "delivery_chat_open", target: custMatch[1].trim() };
  }

  const chatTargetMatch = raw.match(/^CHAT\s+(.+)$/i);
  if (chatTargetMatch?.[1]) {
    const target = chatTargetMatch[1].trim();
    if (DELIVERY_REF_PREFIX_RE.test(target)) {
      return { kind: "delivery_chat_open", target };
    }
    return { kind: "chat_open", target };
  }

  if (upper === "CHAT") return { kind: "chat_open" };

  return { kind: "unknown", raw };
}

const TEAM_HELP_TEXT = [
  "Team Messenger:",
  "CHAT — buksan ang chat sa rider na nag-CHAT",
  "CHAT # o CHAT Juan — piliin ang rider",
  "CHAT CUST TX-1042 — chat sa customer (delivery)",
  "CLOSE CHAT — tapusin ang chat session",
  "Free text — reply sa rider o customer kapag chat mode open",
  "HELP — menu",
].join("\n");

async function replyTeam(params: {
  psid: string;
  stationLabel: string;
  memberName: string;
  body: string;
}): Promise<SendTextResult> {
  const prefix = `🏢 ${params.stationLabel} · ${params.memberName}\n`;
  return sendMetaMessengerText(params.psid, `${prefix}${params.body}`.slice(0, 2000));
}

async function openOwnerChatSession(params: {
  psid: string;
  businessId: string;
  userId: string;
  memberName: string;
  target?: string;
}): Promise<void> {
  const waiting = await listRidersInChatMode(params.businessId);
  if (!waiting.length) {
    await saveTeamMessengerSession({
      psid: params.psid,
      businessId: params.businessId,
      userId: params.userId,
      memberName: params.memberName,
      chatMode: false,
      activeRiderPsid: null,
      activeRiderId: null,
      activeRiderName: null,
    });
    await replyTeam({
      psid: params.psid,
      stationLabel: "Team chat",
      memberName: params.memberName,
      body: "Walang rider na nag-CHAT ngayon. Hintayin silang mag-CHAT sa Messenger.",
    });
    return;
  }

  let selected = waiting.length === 1 ? waiting[0]! : null;
  if (params.target) {
    selected = matchRiderChatTarget(waiting, params.target);
    if (!selected) {
      const lines = waiting.map((row, idx) => `${idx + 1}. ${row.riderName}`).join("\n");
      await replyTeam({
        psid: params.psid,
        stationLabel: "Team chat",
        memberName: params.memberName,
        body: `Hindi mahanap ang rider.\n\nRiders waiting:\n${lines}\n\nHal: CHAT 1 o CHAT Juan`,
      });
      return;
    }
  } else if (waiting.length > 1) {
    const lines = waiting.map((row, idx) => `${idx + 1}. ${row.riderName}`).join("\n");
    await replyTeam({
      psid: params.psid,
      stationLabel: "Team chat",
      memberName: params.memberName,
      body: `Riders waiting:\n${lines}\n\nI-send CHAT # o CHAT name para pumili.`,
    });
    return;
  }

  await saveTeamMessengerSession({
    psid: params.psid,
    businessId: params.businessId,
    userId: params.userId,
    memberName: params.memberName,
    chatMode: true,
    activeRiderPsid: selected!.psid,
    activeRiderId: selected!.riderId,
    activeRiderName: selected!.riderName,
  });

  await replyTeam({
    psid: params.psid,
    stationLabel: "Team chat",
    memberName: params.memberName,
    body: [
      `Chat open kay ${selected!.riderName}.`,
      "Reply freely — naka-sync sa Team Chat sa app.",
      "CLOSE CHAT pag tapos na.",
    ].join("\n"),
  });
}

export async function handleTeamMessengerInboundText(params: {
  psid: string;
  text: string;
}): Promise<void> {
  const command = parseTeamMessengerCommand(params.text);
  const linked = await TeamMessengerLinkService.resolveLinkedMember(params.psid);

  if (command.kind === "link") {
    try {
      const result = await TeamMessengerLinkService.bindPsidWithCode({
        psid: params.psid,
        codeRaw: command.code,
      });
      await saveTeamMessengerSession({
        psid: params.psid,
        businessId: result.businessId,
        userId: result.userId,
        memberName: result.memberName,
        chatMode: false,
      });
      await replyTeam({
        psid: params.psid,
        stationLabel: result.stationLabel,
        memberName: result.memberName,
        body: "✅ Connected na!\nI-send ang CHAT kapag may rider na nag-CHAT sa Messenger.",
      });
    } catch (error) {
      await sendMetaMessengerText(
        params.psid,
        error instanceof Error ? error.message : "Could not link. Try again.",
      );
    }
    return;
  }

  if (!linked) {
    await sendMetaMessengerText(
      params.psid,
      "I-send ang LINK code mula sa Team Hub.\nHal: LINK TMR-7K2M",
    );
    return;
  }

  const session = await getTeamMessengerSession(params.psid);

  if (command.kind === "help") {
    await replyTeam({
      psid: params.psid,
      stationLabel: linked.stationLabel,
      memberName: linked.memberName,
      body: TEAM_HELP_TEXT,
    });
    return;
  }

  if (command.kind === "chat_close") {
    await saveTeamMessengerSession({
      psid: params.psid,
      businessId: linked.businessId,
      userId: linked.userId,
      memberName: linked.memberName,
      chatMode: false,
      activeRiderPsid: null,
      activeRiderId: null,
      activeRiderName: null,
      deliveryChatMode: false,
      deliveryChatThreadId: null,
      deliveryChatCustomerName: null,
      deliveryChatReferenceId: null,
    });
    await replyTeam({
      psid: params.psid,
      stationLabel: linked.stationLabel,
      memberName: linked.memberName,
      body: "Chat closed. I-send CHAT o CHAT CUST {ref} ulit kapag kailangan mag-reply.",
    });
    return;
  }

  if (command.kind === "delivery_chat_open") {
    try {
      const opened = await ownerInitiateDeliveryChat({
        businessId: linked.businessId,
        referenceToken: command.target,
        ownerUserId: linked.userId,
        ownerName: linked.memberName,
      });
      await saveTeamMessengerSession({
        psid: params.psid,
        businessId: linked.businessId,
        userId: linked.userId,
        memberName: linked.memberName,
        chatMode: false,
        activeRiderPsid: null,
        activeRiderId: null,
        activeRiderName: null,
        deliveryChatMode: true,
        deliveryChatThreadId: opened.threadId,
        deliveryChatCustomerName: opened.customerName,
        deliveryChatReferenceId: opened.referenceId,
      });
      await replyTeam({
        psid: params.psid,
        stationLabel: linked.stationLabel,
        memberName: linked.memberName,
        body: [
          `Delivery chat open kay ${opened.customerName} (${opened.referenceId}).`,
          "Reply freely — makikita ng customer sa Messenger.",
          "CLOSE CHAT pag tapos na.",
        ].join("\n"),
      });
    } catch (error) {
      await replyTeam({
        psid: params.psid,
        stationLabel: linked.stationLabel,
        memberName: linked.memberName,
        body: error instanceof Error ? error.message : "Could not open delivery chat.",
      });
    }
    return;
  }

  if (command.kind === "chat_open") {
    await openOwnerChatSession({
      psid: params.psid,
      businessId: linked.businessId,
      userId: linked.userId,
      memberName: linked.memberName,
      target: command.target,
    });
    await saveTeamMessengerSession({
      psid: params.psid,
      businessId: linked.businessId,
      userId: linked.userId,
      memberName: linked.memberName,
      deliveryChatMode: false,
      deliveryChatThreadId: null,
      deliveryChatCustomerName: null,
      deliveryChatReferenceId: null,
    });
    return;
  }

  if (
    session?.deliveryChatMode &&
    session.deliveryChatThreadId
  ) {
    try {
      await ownerReplyToDeliveryChat({
        threadId: session.deliveryChatThreadId,
        businessId: linked.businessId,
        ownerUserId: linked.userId,
        ownerName: linked.memberName,
        text: params.text,
      });
    } catch (error) {
      await replyTeam({
        psid: params.psid,
        stationLabel: linked.stationLabel,
        memberName: linked.memberName,
        body: error instanceof Error ? error.message : "Could not send to customer.",
      });
    }
    return;
  }

  if (
    session?.chatMode &&
    session.activeRiderPsid &&
    session.activeRiderId &&
    session.activeRiderName
  ) {
    await bridgeOwnerTextToRider({
      businessId: linked.businessId,
      ownerUserId: linked.userId,
      ownerName: linked.memberName,
      riderId: session.activeRiderId,
      riderName: session.activeRiderName,
      riderPsid: session.activeRiderPsid,
      text: params.text,
    });
    return;
  }

  await replyTeam({
    psid: params.psid,
    stationLabel: linked.stationLabel,
    memberName: linked.memberName,
    body: `Hindi ko maintindihan ang "${params.text.slice(0, 80)}".\n\n${TEAM_HELP_TEXT}`,
  });
}

export { TEAM_LINK_RE, parseTeamMessengerCommand, TEAM_HELP_TEXT };
