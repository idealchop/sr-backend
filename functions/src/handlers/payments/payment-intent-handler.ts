import { Request, Response } from "express";
import { db } from "../../config/firebase-admin";
import { checkBusinessAccess } from "../../utils/auth-utils";
import { PaymentIntentService } from "../../services/payments/payment-intent-service";
import { PaymentWebhookService } from "../../services/payments/payment-webhook-service";
import { buildMockWebhookSignature } from "../../services/payments/mock-payment-provider";
import type {
  PaymentProviderId,
  SubscriptionPaymentAction,
} from "../../services/payments/payment-intent-types";

function resolvePublicApiBase(req: Request): string {
  const fromEnv = process.env.PUBLIC_API_BASE_URL?.trim();
  if (fromEnv) return fromEnv.replace(/\/$/, "");
  const proto = req.get("x-forwarded-proto") || req.protocol || "https";
  const host = req.get("x-forwarded-host") || req.get("host");
  if (host) return `${proto}://${host}`.replace(/\/$/, "");
  return "https://asia-southeast1-aquaflow-management-suite.cloudfunctions.net/smartrefillV3Api";
}

type AuthUser = {
  uid: string;
  email?: string;
  displayName?: string;
  name?: string;
};

export const postSubscriptionPaymentIntent = async (
  req: Request,
  res: Response,
) => {
  const businessId = String(req.params.businessId || "").trim();
  const user = (req as { user?: AuthUser }).user;
  const targetPlanCode = String(
    req.body?.targetPlanCode || req.body?.planCode || "",
  ).trim();
  const rawAction = String(req.body?.subscriptionAction || req.body?.action || "")
    .trim()
    .toUpperCase();
  const subscriptionAction: SubscriptionPaymentAction =
    rawAction === "RENEW" ? "RENEW" :
      rawAction === "DOWNGRADE" ? "DOWNGRADE" :
        "UPGRADE";
  const billingCycle =
    String(req.body?.billingCycle || "monthly").toLowerCase() === "yearly" ?
      "yearly" :
      "monthly";
  const amount = Number(req.body?.amount ?? req.body?.paymentDetails?.price ?? 0);
  const checkoutPayload =
    req.body?.paymentDetails && typeof req.body.paymentDetails === "object" ?
      req.body.paymentDetails :
      undefined;

  if (!businessId || !targetPlanCode) {
    return res.status(400).json({ error: "businessId and targetPlanCode required" });
  }

  if (!user?.uid) {
    return res.status(401).json({ error: "Unauthorized" });
  }

  try {
    const { hasAccess, role } = await checkBusinessAccess(user.uid, businessId);
    if (!hasAccess || role !== "owner") {
      return res.status(403).json({ error: "Forbidden" });
    }

    let ownerEmail = String(user.email || "").trim();
    let ownerName = String(
      (user as { name?: string; displayName?: string }).displayName ||
        (user as { name?: string }).name ||
        "",
    ).trim();
    if (!ownerEmail) {
      const uSnap = await db.collection("users").doc(user.uid).get();
      if (uSnap.exists) {
        const u = uSnap.data() as Record<string, unknown>;
        ownerEmail = String(u.email || "").trim();
        ownerName = ownerName || String(u.displayName || u.name || "").trim();
      }
    }

    const intent = await PaymentIntentService.createSubscriptionIntent({
      businessId,
      userId: user.uid,
      targetPlanCode,
      subscriptionAction,
      billingCycle,
      amount,
      checkoutPayload,
      ownerEmail: ownerEmail || undefined,
      ownerName: ownerName || undefined,
      apiBaseUrl: resolvePublicApiBase(req),
    });

    return res.status(201).json({
      data: {
        id: intent.id,
        checkoutUrl: intent.checkoutUrl,
        amount: intent.amount,
        status: intent.status,
        provider: intent.provider,
        targetPlanCode: intent.targetPlanCode,
        subscriptionAction: intent.subscriptionAction,
        billingMode: intent.billingMode,
        expiresAt: intent.expiresAt,
      },
    });
  } catch (err) {
    const code = err instanceof Error ? err.message : "CREATE_FAILED";
    const status =
      code === "NO_AMOUNT_DUE" ? 409 :
        code === "PLAN_REQUIRED" ? 400 :
          400;
    return res.status(status).json({ error: code });
  }
};

export const paymentProviderWebhook = (provider: PaymentProviderId) => {
  return async (req: Request, res: Response) => {
    const rawBody =
      (req as Request & { rawBody?: Buffer }).rawBody ||
      Buffer.from(JSON.stringify(req.body || {}));
    const signatureHeader =
      provider === "paymongo" ?
        req.get("paymongo-signature") || undefined :
        req.get("x-smartrefill-signature") || undefined;

    const result = await PaymentWebhookService.processWebhook({
      provider,
      rawBody,
      signatureHeader,
      parsedBody: req.body,
    });

    if (!result.ok && result.error === "INVALID_SIGNATURE") {
      return res.status(403).json({ error: result.error });
    }
    if (!result.ok && result.error === "INVALID_PAYLOAD") {
      return res.status(400).json({ error: result.error });
    }
    if (!result.ok) {
      return res.status(200).json({
        data: {
          ...result,
          acknowledged: true,
        },
      });
    }
    return res.json({ data: result });
  };
};

export const getMockPaymentCheckout = async (req: Request, res: Response) => {
  const businessId = String(req.query.b || req.query.businessId || "").trim();
  const intentId = String(req.params.intentId || "").trim();
  const token = String(req.query.token || "").trim();

  if (!businessId || !intentId || !token) {
    return res.status(400).send("Missing checkout parameters.");
  }

  try {
    const intent = await PaymentIntentService.assertCheckoutToken(
      businessId,
      intentId,
      token,
    );

    const source = String(intent.source || "subscription");
    const isResourceUnlock =
      source === "resource_video" ||
      source === "resource_webinar" ||
      source === "resource_blog";

    const resourceLabel =
      source === "resource_blog" ?
        "premium article" :
        source === "resource_webinar" ?
          "premium webinar" :
          source === "resource_video" ?
            "premium recording" :
            "subscription";

    const linkPurpose =
      intent.checkoutPayload &&
      typeof intent.checkoutPayload === "object" &&
      String(intent.checkoutPayload.purpose || "") === "billing_link";

    const pageTitle = linkPurpose ?
      "SmartRefill link billing account" :
      isResourceUnlock ?
        `SmartRefill ${resourceLabel} test payment` :
        "SmartRefill subscription test payment";
    const pageHeading = linkPurpose ?
      "Link billing account (test)" :
      isResourceUnlock ?
        `Unlock ${resourceLabel} (test)` :
        "Test subscription checkout";
    const pageNote = linkPurpose ?
      "Emulator/dev only — simulates linking GCash/Maya for auto-renew." :
      isResourceUnlock ?
        "Emulator/dev only — simulates a successful unlock webhook (same path as PayMongo)." :
        "Emulator/dev only — simulates a successful provider webhook.";
    const submitLabel = linkPurpose ?
      "Simulate link account" :
      isResourceUnlock ?
        "Simulate unlock payment" :
        "Simulate payment";

    const detailLine = isResourceUnlock ?
      `<p>Item: <strong>${
        String(
          intent.checkoutPayload?.articleTitle ||
              intent.checkoutPayload?.eventName ||
              intent.checkoutPayload?.videoName ||
              resourceLabel,
        )
      }</strong></p>` :
      `<p>Plan: <strong>${intent.targetPlanCode}</strong> (${intent.subscriptionAction})</p>`;

    const html = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>${pageTitle}</title>
  <style>
    body { font-family: system-ui, sans-serif; max-width: 420px; margin: 2rem auto; padding: 0 1rem; }
    button { width: 100%; padding: 0.85rem; font-size: 1rem; border: 0; border-radius: 0.75rem;
      background: #0ea5e9; color: #fff; cursor: pointer; }
    .card { border: 1px solid #e2e8f0; border-radius: 1rem; padding: 1.25rem; }
    p { color: #475569; line-height: 1.5; }
  </style>
</head>
<body>
  <div class="card">
    <h1>${pageHeading}</h1>
    ${detailLine}
    <p>Amount: <strong>₱${intent.amount.toFixed(2)}</strong></p>
    <p>${pageNote}</p>
    <form method="POST" action="">
      <input type="hidden" name="confirm" value="1" />
      <button type="submit">${submitLabel}</button>
    </form>
  </div>
</body>
</html>`;

    if (req.method === "GET") {
      return res.type("html").send(html);
    }

    const eventId = `mock_evt_${Date.now()}`;
    const payload = {
      eventId,
      intentId: intent.id,
      businessId,
      amount: intent.amount,
      providerLinkId: intent.providerLinkId,
      reference: `MOCK-${eventId}`,
      paidAt: new Date().toISOString(),
    };
    const body = JSON.stringify(payload);
    const signature = buildMockWebhookSignature(body);

    const result = await PaymentWebhookService.processWebhook({
      provider: "mock",
      rawBody: body,
      signatureHeader: signature,
      parsedBody: payload,
    });

    if (!result.ok) {
      return res.status(400).type("html").send(
        `<p>Payment failed: ${result.error || "unknown"}</p><a href="">Try again</a>`,
      );
    }

    const successHeading = linkPurpose ?
      "Billing account linked" :
      isResourceUnlock ?
        "Unlock payment recorded" :
        "Subscription payment recorded";
    const successHint = isResourceUnlock ?
      "Close this tab and return to Resources — the article/recording should unlock after refresh." :
      "Close this tab and refresh your plan page.";

    return res.type("html").send(
      `<!DOCTYPE html><html><body style="font-family:system-ui;max-width:420px;margin:2rem auto">
      <h1>${successHeading}</h1>
      <p>Status: <strong>${result.status}</strong>. ${successHint}</p>
      </body></html>`,
    );
  } catch (err) {
    const code = err instanceof Error ? err.message : "CHECKOUT_FAILED";
    return res.status(400).send(`Checkout unavailable: ${code}`);
  }
};
