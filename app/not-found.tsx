import Link from "next/link";

/**
 * 404 ページ (SPEC.md §7 / §12)
 *
 * **自前で用意する理由が2つある。**
 *   1. Next.js の既定の404は `body{color:#000;background:#fff}` を直に流し込むため、
 *      ダークモードでここだけ白くなる (v1.13)
 *   2. このサイトは**権限不足も404で返す**(存在を隠すため)。文面で
 *      「権限がありません」と書いてしまうと、隠している意味が無くなる
 */
export default function NotFound() {
  return (
    <main className="mx-auto flex min-h-dvh max-w-md flex-col items-center justify-center gap-3 px-6 text-center">
      <p className="text-3xl font-bold">404</p>
      <h1 className="text-base font-bold">ページが見つかりません</h1>
      <p className="text-sm text-[var(--muted)]">
        URLが違っているか、すでに無くなっている可能性があります。
      </p>
      <Link
        href="/"
        className="mt-2 rounded-lg border border-[var(--border)] px-4 py-2 text-sm font-medium"
      >
        カレンダーへ戻る
      </Link>
    </main>
  );
}
