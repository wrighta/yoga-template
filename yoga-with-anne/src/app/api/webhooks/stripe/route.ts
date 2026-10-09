import { NextResponse } from "next/server";
import { run, tx, nowIso } from "@/db";
import { verifyStripeSignature, stripeEnabled } from "@/lib/stripe";
import { markOrderPaid } from "@/lib/booking";
import { handleInvoicePaid, handleInvoicePaymentFailed, handleSubscriptionDeleted } from "@/lib/stripe-events";

export async function POST(req: Request) {
  const secret = process.env.STRIPE_WEBHOOK_SECRET;
  const payload = await req.text();
  const sig = req.headers.get("stripe-signature");

  if (!stripeEnabled()) return NextResponse.json({ received: false, reason: "stripe not configured" }, { status: 503 });
  if (!secret) return NextResponse.json({ error: "Webhook secret not configured" }, { status: 500 });
  if (!verifyStripeSignature(payload, sig, secret)) {
    return NextResponse.json({ error: "Invalid signature" }, { status: 400 });
  }

  let event: { id: string; type: string; data: { object: Record<string, unknown> } };
  try {
    event = JSON.parse(payload);
  } catch {
    return NextResponse.json({ error: "Invalid payload" }, { status: 400 });
  }

  // Idempotency: record the event first; if it's already processed, stop here.
  try {
    run(`INSERT INTO stripe_events (id, type, payload) VALUES (?,?,?)`, event.id, event.type, payload.slice(0, 20000));
  } catch {
    return NextResponse.json({ received: true, duplicate: true });
  }

  const obj = event.data.object;
  const orderRef =
    (obj.client_reference_id as string) ||
    ((obj.metadata as Record<string, string> | undefined)?.order_ref) ||
    ((obj.subscription_details as Record<string, unknown> | undefined)?.metadata as Record<string, string> | undefined)?.order_ref ||
    null;

  switch (event.type) {
    case "checkout.session.completed": {
      if (!orderRef) break;
      const session = obj as { payment_status?: string; amount_total?: number; payment_intent?: string; subscription?: string };
      if (session.payment_status === "paid" || session.payment_status === "no_payment_required") {
        // The subscription id travels WITH the payment event so the membership is
        // created once, atomically, with its real Stripe subscription linkage.
        await markOrderPaid(
          orderRef,
          {
            provider: "stripe",
            providerRef: (session.payment_intent as string) || event.id,
            amountCents: session.amount_total ?? null,
          },
          { subscriptionId: (session.subscription as string) || null }
        );
      }
      break;
    }
    case "checkout.session.expired": {
      if (orderRef) {
        tx(() => {
          run(`UPDATE orders SET status = 'expired', updated_at = ? WHERE ref = ? AND status = 'awaiting_payment'`, nowIso(), orderRef);
          run(`UPDATE capacity_holds SET released = 1 WHERE order_id = (SELECT id FROM orders WHERE ref = ?)`, orderRef);
        });
      }
      break;
    }
    case "invoice.paid": {
      await handleInvoicePaid(obj as { subscription?: string });
      break;
    }
    case "invoice.payment_failed": {
      await handleInvoicePaymentFailed(obj as { subscription?: string });
      break;
    }
    case "customer.subscription.deleted": {
      await handleSubscriptionDeleted(obj as { id?: string });
      break;
    }
    default:
      // unhandled event types are recorded (above) and acknowledged
      break;
  }

  return NextResponse.json({ received: true });
}
