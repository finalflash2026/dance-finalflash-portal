import { GoogleSignInButton } from "@/components/GoogleSignInButton";
import { GOOGLE_CLIENT_ID, GOOGLE_IOS_CLIENT_ID } from "@/lib/env";

import { LoginForm } from "./LoginForm";

/**
 * ログイン (SPEC.md §3.3)
 *
 * サーバー側で username → ダミーメールを再合成して signInWithPassword する
 * (POST /api/auth/login)。失敗時は理由を問わず同一メッセージを返す。
 */
export default async function LoginPage({
  searchParams,
}: {
  searchParams: Promise<{ username?: string; error?: string }>;
}) {
  // 新規登録直後は ?username=... で ID を引き継いで入力欄に入れておく
  const { username, error } = await searchParams;

  return (
    <div className="space-y-6">
      <header>
        <h1 className="text-[28px] font-bold leading-tight">ログイン</h1>
        <p className="mt-1 text-[15px] text-[var(--muted)]">
          ダンスサークル練習管理
        </p>
      </header>
      {/* Google でログイン (§3.7 / v1.34)。今までのユーザーIDとパスワードは下に残す。
          OAuth クライアントを設定していない環境ではボタンごと出さない (押してもエラーになるため。v1.49) */}
      {GOOGLE_CLIENT_ID || GOOGLE_IOS_CLIENT_ID ? (
        <>
          <GoogleSignInButton />
          {error === "google" ? (
            <p role="alert" className="text-[15px] text-[var(--danger-fg)]">
              Google でログインできませんでした。もう一度試してください。
            </p>
          ) : null}
          <div className="flex items-center gap-3 text-[13px] text-[var(--muted)]">
            <span className="h-px flex-1 bg-[var(--border)]" />
            ユーザーIDとパスワード
            <span className="h-px flex-1 bg-[var(--border)]" />
          </div>
        </>
      ) : null}
      <LoginForm initialUsername={username ?? ""} />
    </div>
  );
}
