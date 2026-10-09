import { all } from "@/db";

export type NavigationItem = { id: number; label: string; href: string; sort: number };
export type NavigationPlacement = "primary" | "footer";

const PRIMARY_FALLBACK: NavigationItem[] = [
  { id: -1, href: "/classes", label: "Classes & Schedule", sort: 10 },
  { id: -2, href: "/workshops", label: "Workshops", sort: 20 },
  { id: -3, href: "/prices", label: "Prices", sort: 30 },
  { id: -4, href: "/about", label: "About Anne", sort: 40 },
  { id: -5, href: "/faqs", label: "FAQs", sort: 50 },
  { id: -6, href: "/contact", label: "Contact", sort: 60 },
];

const FOOTER_FALLBACK: NavigationItem[] = [
  { id: -7, href: "/prices", label: "Prices & memberships", sort: 10 },
  { id: -8, href: "/faqs", label: "Frequently asked questions", sort: 20 },
  { id: -9, href: "/policies/booking-terms", label: "Booking & cancellation terms", sort: 30 },
  { id: -10, href: "/policies/privacy-notice", label: "Privacy notice", sort: 40 },
  { id: -11, href: "/account", label: "My bookings", sort: 50 },
];

export async function getNavigationItems(placement: NavigationPlacement): Promise<NavigationItem[]> {
  const configured = all<{ id: number }>(`SELECT id FROM navigation_items WHERE placement = ? LIMIT 1`, placement);
  const items = all<NavigationItem>(
    `SELECT n.id, n.label, n.href, n.sort FROM navigation_items n
     LEFT JOIN site_pages p ON p.id = n.page_id
     WHERE n.placement = ? AND n.active = 1 AND (n.page_id IS NULL OR p.status = 'published')
     ORDER BY n.sort, n.id`,
    placement
  );
  if (configured.length > 0) return items.map((item) => ({ id: item.id, label: item.label, href: item.href, sort: item.sort }));
  return placement === "primary" ? PRIMARY_FALLBACK : FOOTER_FALLBACK;
}
