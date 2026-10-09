import { redirect } from "next/navigation";
import { verifyToken } from "../actions";
import { Alert } from "@/components/ui";
import Link from "next/link";
import { safeRedirectPath } from "@/lib/runtime";

export default async function VerifyPage({
  searchParams,
}: {
  searchParams: Promise<{ token?: string; next?: string }>;
}) {
  const { token, next } = await searchParams;
  if (!token) redirect("/account");
  const target = safeRedirectPath(next, "/account/home");
  const result = await verifyToken(token, target);
  if (result.ok) redirect(target);
  return (
    <div className="mx-auto max-w-md px-4 py-16 sm:px-6">
      <h1 className="text-2xl font-semibold text-forest-900">Sign-in link problem</h1>
      <div className="mt-4">
        <Alert kind="error">{result.error}</Alert>
      </div>
      <Link href="/account" className="mt-6 inline-block font-semibold text-forest-800 underline underline-offset-4">
        Request a new link →
      </Link>
    </div>
  );
}
