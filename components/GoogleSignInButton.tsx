"use client";

import { useState } from "react";

import { createClient } from "@/lib/supabase/client";

/**
 * 「Google でログイン」(SPEC.md §3.7 / v1.34)。
 *
 * Google の画面へ移り、戻り先 (/auth/callback) でセッションを作る。
 * 初めての人はそのあと登録の続き (/welcome) へ進む。
 */
export function GoogleSignInButton() {
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function signIn() {
    setPending(true);
    setError(null);
    const { error: oauthError } = await createClient().auth.signInWithOAuth({
      provider: "google",
      options: { redirectTo: `${window.location.origin}/auth/callback` },
    });
    // 成功すると Google の画面へ移るので、ここに戻るのは失敗したときだけ
    if (oauthError) {
      setPending(false);
      setError("Google でログインできませんでした。もう一度試してください。");
    }
  }

  return (
    <div className="space-y-2">
      <button
        type="button"
        onClick={signIn}
        disabled={pending}
        className="flex h-12 w-full items-center justify-center gap-3 rounded-xl border border-[var(--border)] bg-white px-4 text-[16px] font-semibold text-[#1f1f1f] active:opacity-80 disabled:opacity-50"
      >
        <svg viewBox="0 0 48 48" width="20" height="20" aria-hidden>
          <path fill="#FFC107" d="M43.6 20.5H42V20H24v8h11.3C33.7 32.7 29.2 36 24 36c-6.6 0-12-5.4-12-12s5.4-12 12-12c3.1 0 5.8 1.2 7.9 3.1l5.7-5.7C34 6.1 29.3 4 24 4 12.9 4 4 12.9 4 24s8.9 20 20 20 20-8.9 20-20c0-1.3-.1-2.4-.4-3.5z" />
          <path fill="#FF3D00" d="M6.3 14.7l6.6 4.8C14.7 15.1 19 12 24 12c3.1 0 5.8 1.2 7.9 3.1l5.7-5.7C34 6.1 29.3 4 24 4 16.3 4 9.7 8.3 6.3 14.7z" />
          <path fill="#4CAF50" d="M24 44c5.2 0 9.9-2 13.4-5.2l-6.2-5.2C29.2 35.1 26.7 36 24 36c-5.2 0-9.6-3.3-11.3-8l-6.5 5C9.5 39.6 16.2 44 24 44z" />
          <path fill="#1976D2" d="M43.6 20.5H42V20H24v8h11.3c-.8 2.2-2.2 4.2-4.1 5.6l6.2 5.2C37 39.2 44 34 44 24c0-1.3-.1-2.4-.4-3.5z" />
        </svg>
        {pending ? "Google に移動しています…" : "Google でログイン"}
      </button>
      {error ? (
        <p role="alert" className="text-sm text-[var(--danger-fg)]">
          {error}
        </p>
      ) : null}
    </div>
  );
}
