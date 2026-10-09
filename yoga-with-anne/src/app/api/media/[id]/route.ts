import { getMediaBytes } from "@/lib/media";

export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const numericId = Number(id);
  if (!Number.isInteger(numericId) || numericId <= 0) {
    return new Response("Not found", { status: 404 });
  }
  const media = getMediaBytes(numericId);
  if (!media) return new Response("Not found", { status: 404 });
  const body = media.bytes as unknown as Uint8Array;
  return new Response(new Uint8Array(body), {
    headers: {
      "Content-Type": media.mime,
      "Content-Length": String(body.byteLength),
      "Cache-Control": "public, max-age=86400, stale-while-revalidate=604800",
      "Content-Disposition": media.filename ? `inline; filename="${media.filename}"` : "inline",
      "X-Content-Type-Options": "nosniff",
    },
  });
}
