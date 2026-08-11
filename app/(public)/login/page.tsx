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
  searchParams: Promise<{ username?: string }>;
}) {
  // 新規登録直後は ?username=... で ID を引き継いで入力欄に入れておく
  const { username } = await searchParams;

  return (
    <div className="space-y-6">
      <header>
        <h1 className="text-2xl font-bold">ログイン</h1>
        <p className="mt-1 text-sm text-[var(--muted)]">
          ダンスサークル練習管理
        </p>
      </header>
      <LoginForm initialUsername={username ?? ""} />
    </div>
  );
}
