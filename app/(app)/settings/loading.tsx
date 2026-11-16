/**
 * 設定画面のローディング表示 (SPEC.md §12 / v1.31.9)
 *
 * 歯車を押してから設定が出るまでが遅く、押せたのか分からなかった。
 * 境界があると、押した瞬間に骨組みが出て、動的ルートの prefetch も効く
 * ((calendar)/loading.tsx と同じ理由)。設定は notFound() を使わないので
 * 境界の下に置いてもステータスの問題は起きない。
 */
export default function Loading() {
  return (
    <main className="mx-auto max-w-2xl space-y-4 px-4 py-3" aria-busy="true" aria-live="polite">
      <span className="sr-only">読み込み中</span>
      <div className="h-8 w-24 animate-pulse rounded bg-[var(--surface)]" />
      {[0, 1, 2, 3].map((i) => (
        <div key={i} className="h-14 animate-pulse rounded-xl bg-[var(--cell)]" />
      ))}
    </main>
  );
}
