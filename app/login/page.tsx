"use client";

import { Suspense, useState } from "react";
import Image from "next/image";
import { useSearchParams } from "next/navigation";
import { supabase } from "@/lib/supabase/client";
import { WORKSPACE_DOMAIN, safeNext } from "@/lib/auth";
import { LOCAL_USERS, localLoginEnabled } from "@/lib/localLogin";

const ERRORS: Record<string, string> = {
  domain: `Please sign in with your @${WORKSPACE_DOMAIN} Google Workspace account.`,
  auth_failed: "Sign-in failed. Please try again.",
  missing_code: "Sign-in was interrupted. Please try again.",
};

function LoginForm() {
  const searchParams = useSearchParams();
  const next = safeNext(searchParams.get("next"));
  const errorKey = searchParams.get("error");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(errorKey ? (ERRORS[errorKey] ?? ERRORS.auth_failed) : null);

  async function signIn() {
    setLoading(true);
    setError(null);
    const redirectTo = `${window.location.origin}/auth/callback?next=${encodeURIComponent(next)}`;
    const { error } = await supabase.auth.signInWithOAuth({
      provider: "google",
      options: {
        redirectTo,
        // Tells Google to only offer accounts from our Workspace domain.
        queryParams: { hd: WORKSPACE_DOMAIN, prompt: "select_account" },
      },
    });
    if (error) {
      setError(error.message);
      setLoading(false);
    }
  }

  return (
    <div className="bg-white rounded-xl shadow-sm border border-gray-200 p-8 w-full max-w-sm text-center">
      <Image src="/esn-mesa-logo.png" alt="ESN MESA München" width={600} height={334} priority className="h-20 w-auto mx-auto" />
      <h1 className="text-xl font-bold text-gray-900 mt-4">MESA Events</h1>
      <p className="text-sm text-gray-500 mt-1 mb-6">Sign in with your @{WORKSPACE_DOMAIN} account</p>

      {error && (
        <p role="alert" className="text-sm text-red-600 bg-red-50 border border-red-200 rounded-md px-3 py-2 mb-4">
          {error}
        </p>
      )}

      <button
        onClick={signIn}
        disabled={loading}
        className="w-full flex items-center justify-center gap-3 border border-gray-300 rounded-md px-4 py-2.5 text-sm font-medium text-gray-700 hover:bg-gray-50 disabled:opacity-60"
      >
        <svg width="18" height="18" viewBox="0 0 48 48" aria-hidden="true">
          <path fill="#FFC107" d="M43.6 20.5H42V20H24v8h11.3C33.7 32.7 29.2 36 24 36c-6.6 0-12-5.4-12-12s5.4-12 12-12c3.1 0 5.9 1.2 8 3.1l5.7-5.7C34 6.1 29.3 4 24 4 12.9 4 4 12.9 4 24s8.9 20 20 20 20-8.9 20-20c0-1.3-.1-2.4-.4-3.5z" />
          <path fill="#FF3D00" d="M6.3 14.7l6.6 4.8C14.7 15.1 19 12 24 12c3.1 0 5.9 1.2 8 3.1l5.7-5.7C34 6.1 29.3 4 24 4 16.3 4 9.7 8.3 6.3 14.7z" />
          <path fill="#4CAF50" d="M24 44c5.2 0 9.9-2 13.4-5.2l-6.2-5.2C29.2 35.1 26.7 36 24 36c-5.2 0-9.6-3.3-11.3-8l-6.5 5C9.5 39.6 16.2 44 24 44z" />
          <path fill="#1976D2" d="M43.6 20.5H42V20H24v8h11.3c-.8 2.2-2.2 4.2-4.1 5.6l6.2 5.2C37 39.2 44 34 44 24c0-1.3-.1-2.4-.4-3.5z" />
        </svg>
        {loading ? "Redirecting…" : "Sign in with Google"}
      </button>

      {localLoginEnabled() && (
        <form action="/auth/local-login" method="post" className="mt-4 pt-4 border-t border-dashed border-gray-300 text-left space-y-2">
          <input type="hidden" name="next" value={next} />
          <label htmlFor="local-user" className="block text-xs font-medium text-gray-600">
            Local test sign-in as
          </label>
          <select id="local-user" name="email" className="w-full rounded-md border border-gray-300 px-2 py-2 text-sm">
            {LOCAL_USERS.map((u) => (
              <option key={u.email} value={u.email}>
                {u.label} – {u.email}
              </option>
            ))}
          </select>
          <button className="w-full rounded-md border border-dashed border-esn px-4 py-2.5 text-sm font-medium text-esn hover:bg-esn/5">
            Local test sign-in
          </button>
          <p className="text-xs text-gray-400">Local Supabase in development only – seeded members from supabase/seed.sql.</p>
        </form>
      )}
    </div>
  );
}

export default function LoginPage() {
  return (
    <main className="min-h-screen flex items-center justify-center px-4">
      <Suspense>
        <LoginForm />
      </Suspense>
    </main>
  );
}
