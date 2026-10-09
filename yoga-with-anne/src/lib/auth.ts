import { randomBytes, scryptSync, timingSafeEqual, createHash } from "node:crypto";
import { cookies } from "next/headers";
import { get, run, nowIso } from "@/db";

// ---------------- Passwords (admin) ----------------

export function hashPassword(password: string): string {
  const salt = randomBytes(16).toString("hex");
  const hash = scryptSync(password, salt, 64).toString("hex");
  return `${salt}:${hash}`;
}

export function verifyPassword(password: string, stored: string): boolean {
  const [salt, hash] = stored.split(":");
  if (!salt || !hash) return false;
  const candidate = scryptSync(password, salt, 64);
  const expected = Buffer.from(hash, "hex");
  return candidate.length === expected.length && timingSafeEqual(candidate, expected);
}

// ---------------- Admin sessions ----------------

const ADMIN_COOKIE = "ya_admin";
const SESSION_DAYS = 7;

export type AdminRole = "super_admin" | "teacher_owner" | "owner" | "admin" | "instructor" | "teacher";
export type AdminUser = { id: number; email: string; name: string; role: AdminRole };

export async function adminLogin(email: string, password: string): Promise<AdminUser | null> {
  const admin = get<{ id: number; email: string; name: string; role: string; password_hash: string }>(
    `SELECT * FROM admins WHERE email = ?`,
    email.trim().toLowerCase()
  );
  if (!admin || !verifyPassword(password, admin.password_hash)) return null;
  const token = randomBytes(32).toString("hex");
  const expires = new Date(Date.now() + SESSION_DAYS * 86400_000).toISOString();
  run(`INSERT INTO admin_sessions (token, admin_id, expires_at) VALUES (?,?,?)`, token, admin.id, expires);
  const jar = await cookies();
  jar.set(ADMIN_COOKIE, token, {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/",
    expires: new Date(expires),
  });
  return { id: admin.id, email: admin.email, name: admin.name, role: admin.role as AdminRole };
}

export async function adminLogout(): Promise<void> {
  const jar = await cookies();
  const token = jar.get(ADMIN_COOKIE)?.value;
  if (token) run(`DELETE FROM admin_sessions WHERE token = ?`, token);
  jar.delete(ADMIN_COOKIE);
}

export async function requireAdmin(): Promise<AdminUser | null> {
  const jar = await cookies();
  const token = jar.get(ADMIN_COOKIE)?.value;
  if (!token) return null;
  const row = get<{ id: number; email: string; name: string; role: string; expires_at: string }>(
    `SELECT a.id, a.email, a.name, a.role, s.expires_at
     FROM admin_sessions s JOIN admins a ON a.id = s.admin_id
     WHERE s.token = ?`,
    token
  );
  if (!row || row.expires_at < nowIso()) return null;
  return { id: row.id, email: row.email, name: row.name, role: row.role as AdminRole };
}

/** Enforce role permission; owners and admins can act, instructors read-only. */
export function canWrite(role: AdminUser["role"]): boolean {
  return role === "super_admin" || role === "teacher_owner" || role === "owner" || role === "admin" || role === "teacher";
}

/** Super-admin surfaces: pricing, content, appearance, settings, customers, media, messages, team. */
export function canAdminister(role: AdminUser["role"]): boolean {
  return role === "super_admin" || role === "owner" || role === "admin";
}

/** Day-to-day teaching surfaces: schedule, create classes/blocks/workshops, bookings, waitlist. */
export function canManageClasses(role: AdminUser["role"]): boolean {
  return canWrite(role);
}

export async function requireBusinessAdminPage(): Promise<void> {
  const { redirect } = await import("next/navigation");
  const admin = await requireAdmin();
  if (!admin) {
    redirect("/admin/login");
    return;
  }
  if (!canWrite(admin.role)) redirect("/admin");
}

export function adminRoleLabel(role: AdminRole): "Super Admin" | "Teacher-owner" | "Legacy read-only" {
  if (canAdminister(role)) return "Super Admin";
  if (role === "teacher_owner" || role === "teacher") return "Teacher-owner";
  return "Legacy read-only";
}

export type AdminUserWithId = AdminUser & { id: number };

// ---------------- Customer magic links ----------------

const CUSTOMER_COOKIE = "ya_customer";

function hashToken(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

export async function createMagicToken(email: string, purpose = "magic_login"): Promise<{ token: string; email: string } | null> {
  const customer = get<{ id: number; email: string }>(`SELECT id, email FROM customers WHERE email = ?`, email.trim().toLowerCase());
  if (!customer) return null; // caller must respond identically either way (no enumeration)
  const token = randomBytes(32).toString("base64url");
  const expires = new Date(Date.now() + 15 * 60_000).toISOString();
  run(`INSERT INTO customer_tokens (customer_id, token_hash, purpose, expires_at) VALUES (?,?,?,?)`,
    customer.id, hashToken(token), purpose, expires);
  return { token, email: customer.email };
}

export async function consumeMagicToken(token: string): Promise<number | null> {
  const row = get<{ id: number; customer_id: number; expires_at: string; used_at: string | null }>(
    `SELECT id, customer_id, expires_at, used_at FROM customer_tokens WHERE token_hash = ?`,
    hashToken(token)
  );
  if (!row || row.used_at || row.expires_at < nowIso()) return null;
  run(`UPDATE customer_tokens SET used_at = ? WHERE id = ?`, nowIso(), row.id);
  const sessionToken = randomBytes(32).toString("base64url");
  const expires = new Date(Date.now() + 30 * 86400_000).toISOString();
  run(`INSERT INTO customer_tokens (customer_id, token_hash, purpose, expires_at) VALUES (?,?, 'session', ?)`,
    row.customer_id, hashToken(sessionToken), expires);
  const jar = await cookies();
  jar.set(CUSTOMER_COOKIE, sessionToken, {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/",
    expires: new Date(expires),
  });
  return row.customer_id;
}

export async function requireCustomer(): Promise<{ id: number; email: string; name: string | null } | null> {
  const jar = await cookies();
  const token = jar.get(CUSTOMER_COOKIE)?.value;
  if (!token) return null;
  const row = get<{ customer_id: number; expires_at: string }>(
    `SELECT customer_id, expires_at FROM customer_tokens WHERE token_hash = ? AND purpose = 'session'`,
    hashToken(token)
  );
  if (!row || row.expires_at < nowIso()) return null;
  const c = get<{ id: number; email: string; name: string | null }>(`SELECT id, email, name FROM customers WHERE id = ?`, row.customer_id);
  return c ?? null;
}

export async function customerLogout(): Promise<void> {
  const jar = await cookies();
  const token = jar.get(CUSTOMER_COOKIE)?.value;
  if (token) run(`DELETE FROM customer_tokens WHERE token_hash = ?`, hashToken(token));
  jar.delete(CUSTOMER_COOKIE);
}

/** Page-level guard: super-admin-only surfaces redirect teacher admins to the dashboard. */
export async function requireSuperAdminPage(): Promise<void> {
  const admin = await requireAdmin();
  if (admin && !canAdminister(admin.role)) {
    const { redirect } = await import("next/navigation");
    redirect("/admin");
  }
}
