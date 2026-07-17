import {
  sendMetaRiderMessengerQuickReplies,
  sendRiderMessengerPrefixedText,
} from "../meta/meta-rider-messenger-send-service";

export type RiderMessengerCtx = {
  psid: string;
  businessId: string;
  riderId: string;
  riderName: string;
  stationLabel: string;
  metaMessageId?: string;
};

export async function replyRiderMessengerLinked(params: {
  psid: string;
  stationLabel: string;
  riderName: string;
  body: string;
  quickReplies?: Array<{ title: string; payload: string }>;
}): Promise<void> {
  if (params.quickReplies?.length) {
    await sendMetaRiderMessengerQuickReplies({
      recipientPsid: params.psid,
      text: `📍 ${params.stationLabel} · ${params.riderName}\n${params.body}`.slice(0, 2000),
      quickReplies: params.quickReplies,
    });
    return;
  }
  await sendRiderMessengerPrefixedText({
    recipientPsid: params.psid,
    stationLabel: params.stationLabel,
    riderName: params.riderName,
    body: params.body,
  });
}
