import { NextResponse } from "next/server";
import { get } from "@/db";

export async function GET(_req: Request, { params }: { params: Promise<{ ref: string }> }) {
  const { ref } = await params;
  const order = get<{ ref: string; status: string }>(`SELECT ref, status FROM orders WHERE ref = ?`, ref);
  if (!order) return NextResponse.json({ error: "not found" }, { status: 404 });
  return NextResponse.json({ status: order.status });
}
