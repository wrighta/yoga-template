"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { audit } from "@/db";
import { requireAdmin, canAdminister } from "@/lib/auth";
import { sendTemplate } from "@/lib/mail";

/** Admin diagnostic: send a test email to a chosen address through the normal pipeline. */
export async function sendTestEmailAction(formData: FormData) {
  const admin = await requireAdmin();
  if (!admin) redirect("/admin/login");
  if (!canAdminister(admin.role)) redirect("/admin?error=Only+a+Super+Admin+can+test+email+settings");
  const to = String(formData.get("to") ?? "").trim();
  if (!to.includes("@")) redirect("/admin/messages?testerror=Enter+a+valid+email+address");
  await sendTemplate(
    "magic_login",
    to,
    { login_url: `${process.env.NEXT_PUBLIC_SITE_URL || "http://localhost:3000"}/account` },
    { relatedType: "test" }
  );
  audit("email.test_sent", { actorType: "admin", actor: admin.email, detail: { to } });
  revalidatePath("/admin/messages");
  redirect("/admin/messages?testsent=1");
}
