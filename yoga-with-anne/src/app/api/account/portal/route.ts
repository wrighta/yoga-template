import { NextResponse } from "next/server";
import { requireCustomer } from "@/lib/auth";
import { createBillingPortalUrl } from "@/lib/portal";

/** Stripe Billing Portal session for the signed-in customer. Fails closed when unconfigured. */
export async function POST(req: Request) {
  const customer = await requireCustomer();
  if (!customer) return NextResponse.json({ error: "Please sign in first." }, { status: 401 });
  const origin = new URL(req.url).origin;
  const result = await createBillingPortalUrl(customer.id, origin);
  if ("error" in result) return NextResponse.json({ error: result.error }, { status: 503 });
  return NextResponse.json({ url: result.url });
}
