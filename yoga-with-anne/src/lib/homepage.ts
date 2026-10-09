import { getSetting } from "@/lib/settings";

export const HOMEPAGE_SECTION_DEFINITIONS = [
  { id: "hero", label: "Hero" },
  { id: "services", label: "Service modules" },
  { id: "classes", label: "Next available classes" },
  { id: "expect", label: "What to expect" },
  { id: "suits", label: "Who the classes suit" },
  { id: "pricing", label: "Pricing preview" },
  { id: "meet", label: "Meet Anne" },
  { id: "venue", label: "Venue" },
  { id: "testimonials", label: "Testimonials" },
  { id: "faqs", label: "FAQ preview" },
  { id: "newsletter", label: "Newsletter" },
] as const;

export type HomepageSectionId = (typeof HOMEPAGE_SECTION_DEFINITIONS)[number]["id"];
export type HomepageSection = { id: HomepageSectionId; active: boolean; sort: number };

const DEFAULT_SECTIONS: HomepageSection[] = HOMEPAGE_SECTION_DEFINITIONS.map((section, index) => ({
  id: section.id,
  active: true,
  sort: index + 1,
}));

export async function getHomepageSections(): Promise<HomepageSection[]> {
  const stored = await getSetting<unknown>("homepage_sections");
  if (!Array.isArray(stored)) return DEFAULT_SECTIONS.map((section) => ({ ...section }));
  const validIds = new Set<string>(HOMEPAGE_SECTION_DEFINITIONS.map((section) => section.id));
  const byId = new Map<HomepageSectionId, HomepageSection>();
  for (const entry of stored) {
    if (typeof entry !== "object" || entry === null) continue;
    const value = entry as { id?: unknown; active?: unknown; sort?: unknown };
    if (typeof value.id !== "string" || !validIds.has(value.id) || byId.has(value.id as HomepageSectionId)) continue;
    const fallback = DEFAULT_SECTIONS.find((section) => section.id === value.id)!;
    byId.set(value.id as HomepageSectionId, {
      id: fallback.id,
      active: typeof value.active === "boolean" ? value.active : fallback.active,
      sort: Number.isInteger(value.sort) ? Number(value.sort) : fallback.sort,
    });
  }
  return DEFAULT_SECTIONS.map((section) => byId.get(section.id) ?? { ...section }).sort((a, b) => a.sort - b.sort || DEFAULT_SECTIONS.findIndex((item) => item.id === a.id) - DEFAULT_SECTIONS.findIndex((item) => item.id === b.id));
}