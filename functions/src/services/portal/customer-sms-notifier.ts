import { logger } from "firebase-functions";
import { brevo, getBrevoSmsApi } from "../../utils/brevo";
import {
  ChannelUsageLimitError,
  ChannelUsageService,
} from "../channels/channel-usage-service";
import type { Customer } from "../customers/customer-service";

function formatPhilippinePhone(phone: string): string | null {
  const digits = phone.replace(/\D/g, "");
  if (digits.length < 10) return null;
  if (digits.startsWith("63") && digits.length >= 12) return `+${digits}`;
  if (digits.startsWith("0") && digits.length === 11) return `+63${digits.slice(1)}`;
  if (digits.length === 10) return `+63${digits}`;
  return `+${digits}`;
}

/**
 * NT-36 / NT-40 — customer SMS for transaction status via Brevo transactional SMS.
 */
export async function maybeSendCustomerTxnSms(args: {
  businessId: string;
  customer: Customer;
  referenceId: string;
  statusLabel: string;
  trackUrl: string;
}): Promise<{ sent: boolean }> {
  const recipient = formatPhilippinePhone(String(args.customer.phone || ""));
  if (!recipient) return { sent: false };

  const shortRef =
    args.referenceId.length > 12 ?
      args.referenceId.slice(-12) :
      args.referenceId;
  const body =
    `${args.statusLabel} ref ${shortRef}. ${args.trackUrl}`.slice(0, 320);

  if (process.env.FUNCTIONS_EMULATOR) {
    logger.info("EMULATOR: customer txn SMS", {
      businessId: args.businessId,
      phone: recipient,
      body,
    });
    return { sent: true };
  }

  if (process.env.SMARTREFILL_SMS_ENABLED !== "true") {
    return { sent: false };
  }

  try {
    await ChannelUsageService.assertWithinCap(args.businessId, "smsSegments", 1);
  } catch (usageErr) {
    if (usageErr instanceof ChannelUsageLimitError) {
      logger.warn("customer_txn_sms_cap_blocked", {
        businessId: args.businessId,
        referenceId: args.referenceId,
        used: usageErr.used,
        cap: usageErr.cap,
      });
      return { sent: false };
    }
    throw usageErr;
  }

  try {
    const api = getBrevoSmsApi();
    const sms = new brevo.SendTransacSms();
    sms.sender = "SmartRefill";
    sms.recipient = recipient;
    sms.content = body;
    sms.type = brevo.SendTransacSms.TypeEnum.Transactional;
    sms.tag = "customer_txn_status";

    await api.sendTransacSms(sms);

    try {
      await ChannelUsageService.recordUsage(args.businessId, "smsSegments", 1);
    } catch (usageErr) {
      logger.warn("customer_txn_sms_usage_record_failed", {
        businessId: args.businessId,
        usageErr,
      });
    }

    logger.info("customer_txn_sms_sent", {
      businessId: args.businessId,
      referenceId: args.referenceId,
      phoneLast4: recipient.slice(-4),
    });
    return { sent: true };
  } catch (error) {
    logger.warn("customer_txn_sms_failed", {
      businessId: args.businessId,
      referenceId: args.referenceId,
      error,
    });
    return { sent: false };
  }
}
