import { ImageResponse } from "next/og";
import { getSettings } from "@/lib/settings";
import { getMediaBytes } from "@/lib/media";
import { getWeeklyScheduleSummary } from "@/lib/settings";

export const runtime = "nodejs";
// Dynamic: reads the database (settings/venue) - never prerendered at build time.
export const dynamic = "force-dynamic";

/**
 * Branded social-share image (1200×630). Used automatically when no custom
 * social image has been uploaded in the admin area.
 */
export async function GET(req: Request) {
  const settings = await getSettings();
  const url = new URL(req.url);
  const title = (url.searchParams.get("title") ?? settings.tagline).slice(0, 90);
  const scheduleSummary = await getWeeklyScheduleSummary();
  const scheduleLine = scheduleSummary ? scheduleSummary.split(",")[0] : "Lucan";

  // Custom uploaded social image takes precedence
  if (settings.og_media_id) {
    const media = getMediaBytes(settings.og_media_id);
    if (media) {
      return new Response(new Uint8Array(media.bytes as unknown as Uint8Array), {
        headers: { "Content-Type": media.mime, "Cache-Control": "public, max-age=3600" },
      });
    }
  }

  return new ImageResponse(
    (
      <div
        style={{
          width: "100%",
          height: "100%",
          display: "flex",
          flexDirection: "column",
          justifyContent: "space-between",
          background: "linear-gradient(135deg, #f4efe6 0%, #e7ede7 55%, #d5e0d6 100%)",
          padding: 72,
          fontFamily: "sans-serif",
        }}
      >
        <div style={{ display: "flex", alignItems: "center", gap: 18 }}>
          <div style={{ width: 56, height: 56, borderRadius: 16, background: "#2f4a3c", display: "flex", alignItems: "center", justifyContent: "center" }}>
            <svg width="34" height="34" viewBox="0 0 30 30">
              <path d="M15 5 C 11 9, 11 13, 15 16 C 19 13, 19 9, 15 5 Z" fill="#f4efe6" />
              <path d="M7 20 Q 15 24 23 20" stroke="#b98a2f" strokeWidth="1.8" fill="none" strokeLinecap="round" />
            </svg>
          </div>
          <div style={{ fontSize: 34, fontWeight: 700, color: "#2f4a3c" }}>{settings.business_name}</div>
        </div>
        <div style={{ display: "flex", flexDirection: "column", gap: 18 }}>
          <div style={{ fontSize: 64, fontWeight: 700, lineHeight: 1.1, color: "#1e3228", maxWidth: 940 }}>{title}</div>
          <div style={{ display: "flex", gap: 14, alignItems: "center" }}>
            <div style={{ padding: "10px 26px", borderRadius: 999, background: "#2f4a3c", color: "#f4efe6", fontSize: 28, fontWeight: 600 }}>
              {`${scheduleLine} · Lucan`}
            </div>
            <div style={{ padding: "10px 26px", borderRadius: 999, background: "#ffffff", color: "#2f4a3c", fontSize: 28, fontWeight: 600, border: "2px solid #b9cabd" }}>
              All levels welcome
            </div>
          </div>
        </div>
      </div>
    ),
    { width: 1200, height: 630 }
  );
}
