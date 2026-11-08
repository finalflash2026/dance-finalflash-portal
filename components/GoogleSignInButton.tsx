"use client";

import { useEffect, useRef, useState } from "react";

import { GOOGLE_CLIENT_ID, GOOGLE_IOS_CLIENT_ID } from "@/lib/env";
import { createNonce, loadGoogleIdentity } from "@/lib/google-signin";
import { APP_AUTH_CALLBACK, APP_URL_SCHEME, appUrlToPath, isNativeApp } from "@/lib/native";
import { createClient } from "@/lib/supabase/client";

/**
 * 「Google でログイン」(SPEC.md §3.7 / v1.34)。
 *
 * Google の画面へ移り、戻り先 (/auth/callback) でセッションを作る。
 * 初めての人はそのあと登録の続き (/welcome) へ進む。
 *
 * iOS アプリでは Google が WebView でのログインを拒むので、iOS の OAuth 専用の画面
 * (ASWebAuthenticationSession) で開き、Supabase から ffcalendar:// で直接戻す
 * (SPEC §2.3 / v1.40)。
 */
export function GoogleSignInButton() {
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  /** Web で Google 公式のボタンを出せたか (出せなければ今までのボタン) */
  const [officialButton, setOfficialButton] = useState(false);
  const officialRef = useRef<HTMLDivElement>(null);

  const failed = () => {
    setPending(false);
    setError("Google でログインできませんでした。もう一度試してください。");
  };

  /** ID トークンをセッションに換え、ホームへ (プロフィールが無ければレイアウトが /welcome へ送る) */
  async function finishWithIdToken(idToken: string, rawNonce: string) {
    const { error: idError } = await createClient().auth.signInWithIdToken({
      provider: "google",
      token: idToken,
      nonce: rawNonce,
    });
    if (idError) return failed();
    window.location.assign("/");
  }

  // Web: Google 公式のボタン (v1.41)
  useEffect(() => {
    if (!GOOGLE_CLIENT_ID || isNativeApp()) return;
    let cancelled = false;
    void (async () => {
      try {
        const [google, nonce] = await Promise.all([loadGoogleIdentity(), createNonce()]);
        if (cancelled || !officialRef.current) return;
        google.accounts.id.initialize({
          client_id: GOOGLE_CLIENT_ID,
          nonce: nonce.hashed,
          ux_mode: "popup",
          use_fedcm_for_button: true,
          callback: ({ credential }) => {
            if (!credential) return failed();
            setPending(true);
            void finishWithIdToken(credential, nonce.raw);
          },
        });
        const dark = document.documentElement.dataset.theme === "dark";
        google.accounts.id.renderButton(officialRef.current, {
          type: "standard",
          theme: dark ? "filled_black" : "outline",
          size: "large",
          text: "signin_with",
          shape: "pill",
          logo_alignment: "center",
          width: Math.min(400, officialRef.current.clientWidth || 320),
          locale: "ja",
        });
        setOfficialButton(true);
      } catch {
        // 読み込めなければ今までのボタン (Supabase 経由) のまま
      }
    })();
    return () => {
      cancelled = true;
    };
    // finishWithIdToken / failed は state の setter だけを使うので依存に入れない
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function signIn() {
    setPending(true);
    setError(null);

    // アプリ: iOS 用のクライアントで Google に直接聞く (v1.41)
    if (isNativeApp() && GOOGLE_IOS_CLIENT_ID) {
      try {
        const nonce = await createNonce();
        const { FFNative } = await import("@/lib/native-plugin");
        const result = await FFNative.googleSignIn({
          clientId: GOOGLE_IOS_CLIENT_ID,
          nonce: nonce.hashed,
        });
        if (!result.idToken) {
          setPending(false);
          return;
        }
        await finishWithIdToken(result.idToken, nonce.raw);
      } catch {
        failed();
      }
      return;
    }

    if (isNativeApp()) {
      // Supabase から直接 ffcalendar:// へ戻し、iOS の OAuth の画面がそれを受け取る
      // (v1.40。アプリ内の Safari ではアプリへの転送が止まり、ブラウザでサイトが開いていた)
      const { data, error: oauthError } = await createClient().auth.signInWithOAuth({
        provider: "google",
        options: { redirectTo: APP_AUTH_CALLBACK, skipBrowserRedirect: true },
      });
      if (oauthError || !data.url) return failed();
      try {
        const { FFNative } = await import("@/lib/native-plugin");
        const result = await FFNative.authenticate({
          url: data.url,
          callbackScheme: APP_URL_SCHEME,
        });
        if (!result.url) {
          setPending(false);
          return;
        }
        // PKCE の鍵はこの WebView の cookie にあるので、ここでセッションに換える
        window.location.assign(appUrlToPath(result.url) ?? "/login?error=google");
      } catch {
        failed();
      }
      return;
    }

    const { error: oauthError } = await createClient().auth.signInWithOAuth({
      provider: "google",
      options: { redirectTo: `${window.location.origin}/auth/callback` },
    });
    // 成功すると Google の画面へ移るので、ここに戻るのは失敗したときだけ
    if (oauthError) failed();
  }

  return (
    <div className="space-y-2">
      {/* Google 公式のボタンはここに描かれる (Web で設定があるとき。v1.41) */}
      <div
        ref={officialRef}
        className={officialButton ? "flex h-12 w-full justify-center" : "hidden"}
      />
      {officialButton && pending ? (
        <p className="text-center text-sm text-[var(--muted)]">ログインしています…</p>
      ) : null}
      {officialButton ? null : (
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
      )}
      {error ? (
        <p role="alert" className="text-sm text-[var(--danger-fg)]">
          {error}
        </p>
      ) : null}
    </div>
  );
}
