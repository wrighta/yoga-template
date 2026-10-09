import { getSettings } from "./settings";

/**
 * Brand palettes. Each palette maps 16 colour ROLES that the whole site uses
 * (see globals.css where Tailwind tokens are rewired to these variables).
 * Presets are curated so text/contrast stays WCAG-AA readable; a custom accent
 * can be layered on top in Admin → Appearance.
 */
export type Palette = {
  id: string;
  name: string;
  vars: Record<PaletteVar, string>;
};

export type PaletteVar =
  | "--b950" | "--b900" | "--b800" | "--b700" | "--b600" // deep brand (text, headings, buttons)
  | "--t100" | "--t200" | "--t300" // brand tints (soft fills, borders)
  | "--a100" | "--a200" | "--a500" | "--a600" | "--a700" // accent (CTAs, links, alerts)
  | "--s50" | "--s100" | "--s200" | "--s300"; // surfaces (page + cards)

export const PALETTES: Palette[] = [
  {
    id: "sage-cream",
    name: "Sage & Cream (classic)",
    vars: {
      "--b950": "#16241d", "--b900": "#1e3228", "--b800": "#2f4a3c", "--b700": "#3c5c4b", "--b600": "#4d7160",
      "--t100": "#e7ede7", "--t200": "#d5e0d6", "--t300": "#b9cabd",
      "--a100": "#f7e6dd", "--a200": "#efcfc0", "--a500": "#c9764f", "--a600": "#b85c3f", "--a700": "#9c4d33",
      "--s50": "#faf8f3", "--s100": "#f4efe6", "--s200": "#eae2d2", "--s300": "#ddd2bd",
    },
  },
  {
    id: "terracotta-sand",
    name: "Terracotta & Sand",
    vars: {
      "--b950": "#2b1510", "--b900": "#4a2318", "--b800": "#6b3323", "--b700": "#82432f", "--b600": "#9a5a42",
      "--t100": "#f3e4d7", "--t200": "#e8cdb4", "--t300": "#d9b08e",
      "--a100": "#f0e6d2", "--a200": "#e3d0a8", "--a500": "#a1762a", "--a600": "#8a6423", "--a700": "#6f511c",
      "--s50": "#faf6ef", "--s100": "#f5ede1", "--s200": "#e9dcc8", "--s300": "#dcc9ac",
    },
  },
  {
    id: "lavender-stone",
    name: "Lavender & Stone",
    vars: {
      "--b950": "#241f33", "--b900": "#352e4d", "--b800": "#4a4170", "--b700": "#5a5188", "--b600": "#6d64a0",
      "--t100": "#ece9f5", "--t200": "#d9d4ec", "--t300": "#c4bcde",
      "--a100": "#f2e8e0", "--a200": "#e4cec0", "--a500": "#b07a4f", "--a600": "#9a6540", "--a700": "#7d5233",
      "--s50": "#f9f8fb", "--s100": "#f1eff6", "--s200": "#e2dfe9", "--s300": "#cfcadd",
    },
  },
  {
    id: "ocean-linen",
    name: "Ocean & Linen",
    vars: {
      "--b950": "#12242e", "--b900": "#1b3a49", "--b800": "#245468", "--b700": "#2d6a82", "--b600": "#3a83a0",
      "--t100": "#e2edf1", "--t200": "#c9dde4", "--t300": "#a9c9d3",
      "--a100": "#f4e8da", "--a200": "#e8d2b6", "--a500": "#b0783a", "--a600": "#96622c", "--a700": "#7a4f23",
      "--s50": "#f7fafb", "--s100": "#eef4f6", "--s200": "#dde8ec", "--s300": "#c6d6db",
    },
  },
  {
    id: "rose-oat",
    name: "Rose & Oat",
    vars: {
      "--b950": "#33201f", "--b900": "#4f2b28", "--b800": "#6f3c37", "--b700": "#8a4c44", "--b600": "#a56159",
      "--t100": "#f6e7e4", "--t200": "#ecd0cb", "--t300": "#dcb3ab",
      "--a100": "#f7e3e7", "--a200": "#ecc5cd", "--a500": "#b0576b", "--a600": "#8f4356", "--a700": "#733545",
      "--s50": "#fbf7f3", "--s100": "#f6efe7", "--s200": "#eae0d2", "--s300": "#d9cab6",
    },
  },
  {
    id: "forest-tangerine",
    name: "Forest & Tangerine",
    vars: {
      "--b950": "#10211a", "--b900": "#173427", "--b800": "#20543a", "--b700": "#2f704b", "--b600": "#478d63",
      "--t100": "#dcecdf", "--t200": "#bdd8c2", "--t300": "#95bd9d",
      "--a100": "#fff0df", "--a200": "#ffd6ad", "--a500": "#e77c3d", "--a600": "#bd4e21", "--a700": "#963a18",
      "--s50": "#faf8f1", "--s100": "#f2ecdf", "--s200": "#e5dbc6", "--s300": "#d1c2a0",
    },
  },
  {
    id: "pine-coral",
    name: "Pine & Coral",
    vars: {
      "--b950": "#102126", "--b900": "#18383d", "--b800": "#24585b", "--b700": "#347477", "--b600": "#498e8b",
      "--t100": "#dcece8", "--t200": "#bedbd4", "--t300": "#97c2b8",
      "--a100": "#fff0e6", "--a200": "#ffd5bd", "--a500": "#e9805b", "--a600": "#c65535", "--a700": "#9e4028",
      "--s50": "#faf8f2", "--s100": "#f0eee4", "--s200": "#e0ddcf", "--s300": "#c9c4b2",
    },
  },
];

export function getPalette(id: string): Palette {
  return PALETTES.find((p) => p.id === id) ?? PALETTES[0];
}

function normaliseHex(input: string): string | null {
  const v = input.trim();
  return /^#[0-9a-fA-F]{6}$/.test(v) ? v.toLowerCase() : null;
}

/**
 * CSS custom-property overrides for the chosen palette + optional custom accent.
 * Emitted with an `html:root` selector so it always wins over the stylesheet
 * defaults regardless of load order.
 */
export function appearanceCssFor(paletteId: string, accentColor: string | null): string {
  const palette = getPalette(paletteId);
  const lines = Object.entries(palette.vars).map(([k, v]) => `${k}:${v};`);
  const accent = normaliseHex(accentColor ?? "");
  if (accent) {
    lines.push(
      `--a600:${accent};`,
      `--a700:color-mix(in srgb, ${accent} 82%, black);`,
      `--a500:color-mix(in srgb, ${accent} 88%, white);`,
      `--a200:color-mix(in srgb, ${accent} 25%, white);`,
      `--a100:color-mix(in srgb, ${accent} 12%, white);`
    );
  }
  return `html:root{${lines.join("")}}`;
}

export async function appearanceCss(): Promise<string> {
  const settings = await getSettings();
  return appearanceCssFor(settings.palette_id, settings.accent_color);
}
