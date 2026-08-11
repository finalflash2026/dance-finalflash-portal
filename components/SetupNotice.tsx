/**
 * Supabase 未接続時の案内 (SPEC.md §14 セットアップ手順)
 *
 * 環境変数が無い状態でも dev サーバーが起動して画面が見えるようにしてある。
 * 何をすれば動くのかをここに出しておく。
 */
export function SetupNotice() {
  return (
    <main className="mx-auto max-w-2xl space-y-4 px-4 py-8">
      <h1 className="text-xl font-bold">セットアップが必要です</h1>
      <p className="text-sm text-[var(--muted)]">
        Supabase の環境変数が未設定です。SPEC.md §14 の手順で接続してください。
      </p>
      <ol className="list-decimal space-y-2 pl-5 text-sm">
        <li>Supabase プロジェクトを作成する</li>
        <li>
          SQL Editor で{" "}
          <code className="rounded bg-[var(--surface)] px-1">
            supabase/migrations/0001_init.sql
          </code>{" "}
          を実行する
        </li>
        <li>
          Authentication で「Allow new users to sign up」を OFF、「Confirm
          email」を OFF にする
        </li>
        <li>
          <code className="rounded bg-[var(--surface)] px-1">
            cp .env.example .env.local
          </code>{" "}
          して URL / anon key / service role key を記入する
        </li>
        <li>
          <code className="rounded bg-[var(--surface)] px-1">
            npm run set-passphrase
          </code>{" "}
          で合言葉3種を投入する
        </li>
        <li>dev サーバーを再起動する</li>
      </ol>
    </main>
  );
}
