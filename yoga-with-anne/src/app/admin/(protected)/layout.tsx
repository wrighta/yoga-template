import Link from "next/link";
import { redirect } from "next/navigation";
import { requireAdmin, canWrite, canAdminister, adminRoleLabel } from "@/lib/auth";
import { adminLogoutAction } from "@/app/admin/actions";

export const dynamic = "force-dynamic";

const TEACHER_NAV = [
  { href: "/admin", label: "Dashboard" },
  { href: "/admin/classes", label: "Schedule" },
  { href: "/admin/classes/new", label: "Create classes" },
  { href: "/admin/bookings", label: "Bookings" },
  { href: "/admin/waitlist", label: "Waitlist" },
  { href: "/admin/customers", label: "Students" },
  { href: "/admin/pricing", label: "Pricing" },
];
const SUPER_NAV = [
  { href: "/admin/class-types", label: "Class types" },
  { href: "/admin/venues", label: "Venues" },
  { href: "/admin/instructors", label: "Instructors" },
  { href: "/admin/content", label: "Content" },
  { href: "/admin/pages", label: "Pages & menus" },
  { href: "/admin/media", label: "Photos" },
  { href: "/admin/appearance", label: "Appearance" },
  { href: "/admin/messages", label: "Messages" },
  { href: "/admin/health", label: "Launch readiness" },
  { href: "/admin/settings", label: "Settings" },
  { href: "/admin/audit", label: "Audit log" },
];
const nav = (role: string) => (canAdminister(role as Parameters<typeof canAdminister>[0]) ? [...TEACHER_NAV, ...SUPER_NAV] : TEACHER_NAV);

export default async function AdminLayout({ children }: { children: React.ReactNode }) {
  const admin = await requireAdmin();
  if (!admin) redirect("/admin/login");
  const writable = canWrite(admin.role);
  return (
    <div className="min-h-dvh bg-oat-100">
      <a href="#admin-main" className="sr-only focus:not-sr-only focus:absolute focus:left-4 focus:top-4 focus:z-50 focus:rounded-full focus:bg-forest-800 focus:px-4 focus:py-2 focus:text-white">
        Skip to content
      </a>
      <div className="mx-auto flex max-w-7xl flex-col lg:flex-row">
        <aside className="w-full min-w-0 shrink-0 border-b border-oat-200 bg-white lg:min-h-dvh lg:w-60 lg:border-b-0 lg:border-r">
          <div className="px-5 py-5">
            <Link href="/admin" className="font-display text-lg font-semibold text-forest-900">Anne&apos;s admin</Link>
            <p className="mt-0.5 text-xs text-bark-500">
              {admin.name} · <span className="tracking-wide">{adminRoleLabel(admin.role)}</span>
            </p>
          </div>
          <nav aria-label="Admin navigation" className="flex gap-1 overflow-x-auto px-3 pb-3 lg:flex-col lg:overflow-visible">
            {nav(admin.role).map((n) => (
              <Link key={n.href} href={n.href} className="whitespace-nowrap rounded-xl px-4 py-2.5 text-sm font-semibold text-forest-900 hover:bg-sage-100">
                {n.label}
              </Link>
            ))}
            <Link href="/" className="whitespace-nowrap rounded-xl px-4 py-2.5 text-sm font-semibold text-bark-500 hover:bg-sage-100">
              View website ↗
            </Link>
          </nav>
          <div className="px-5 py-4">
            <form action={adminLogoutAction}>
              <button type="submit" className="text-sm font-semibold text-clay-700 underline underline-offset-4">Sign out</button>
            </form>
          </div>
        </aside>
        <main id="admin-main" className="min-w-0 flex-1 px-4 py-8 sm:px-8">
          {!writable && (
            <div className="mb-6 rounded-xl bg-gold-200/50 px-4 py-3 text-sm font-medium text-gold-700">
              You are signed in with read-only access (instructor).
            </div>
          )}
          {children}
        </main>
      </div>
    </div>
  );
}
