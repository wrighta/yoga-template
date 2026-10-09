import { getSettings } from "@/lib/settings";
import { PALETTES } from "@/lib/appearance";
import { Card, Alert } from "@/components/ui";
import { requireSuperAdminPage } from "@/lib/auth";
import { AppearanceControls } from "./appearance-controls";

export default async function AdminAppearancePage({
  searchParams,
}: {
  searchParams: Promise<{ saved?: string; error?: string }>;
}) {
  await requireSuperAdminPage();
  const sp = await searchParams;
  const settings = await getSettings();

  return (
    <div className="space-y-8">
      <h1 className="text-3xl font-semibold text-forest-900">Appearance</h1>
      {sp.saved ? <Alert kind="success">Colours saved - the whole website updates instantly.</Alert> : null}
      {sp.error ? <Alert kind="error">{sp.error}</Alert> : null}
      <Alert kind="info">
        Choose the colour palette closest to your brand, then optionally add your own accent colour (buttons, links and
        highlights). Curated palettes keep every page readable; the accent is layered on top.
      </Alert>

      <Card className="p-6">
        <AppearanceControls palettes={PALETTES} currentPalette={settings.palette_id} currentAccent={settings.accent_color} />
      </Card>
    </div>
  );
}
