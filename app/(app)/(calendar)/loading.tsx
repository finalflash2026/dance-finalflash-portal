/**
 * カレンダー画面 (/ と /me) のローディング表示
 * (SPEC.md §12「ローディング中はスケルトン表示」)
 *
 * 効果は2つある:
 *   1. ナビゲーション直後に即座に骨組みを出す(画面が固まって見えなくなる)
 *   2. **動的ルートの prefetch が有効になる**。Next.js は loading 境界がある
 *      場合にのみ動的セグメントを先読みするため、これが無いと `<Link>` の
 *      prefetch がまったく効かない
 *
 * **(app) 直下ではなく (calendar) グループに置いている。** 理由は2つ:
 *   - 骨組みがミニカレンダー+日別ビューの形なので、設定画面などに出すと嘘になる
 *   - loading 境界より下で notFound() を呼ぶと、シェルが 200 で流れ始めた後に
 *     404 が確定するため **HTTP ステータスが 200 のままになる**。
 *     `/coordinator` のような権限つき画面は「権限不足は404で存在を隠す」
 *     (SPEC §7) 必要があり、境界の下に置くとこれが成立しない。
 */
export default function Loading() {
  return (
    <main
      className="mx-auto max-w-2xl space-y-4 px-4 py-4"
      aria-busy="true"
      aria-live="polite"
    >
      <span className="sr-only">読み込み中</span>

      <div className="h-7 w-40 animate-pulse rounded bg-[var(--surface)]" />

      <div className="space-y-3 rounded-xl border border-[var(--border)] p-3">
        <div className="mx-auto h-5 w-28 animate-pulse rounded bg-[var(--surface)]" />
        <div className="grid grid-cols-7 gap-2">
          {Array.from({ length: 35 }, (_, i) => (
            <div
              key={i}
              className="h-8 animate-pulse rounded-full bg-[var(--surface)]"
            />
          ))}
        </div>
      </div>

      <div className="h-64 animate-pulse rounded-xl border border-[var(--border)] bg-[var(--surface)]" />
    </main>
  );
}
