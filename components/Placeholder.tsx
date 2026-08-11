/**
 * 未実装画面の仮表示。
 * 実装が済んだ画面から順に置き換えて消していく。
 */
export function Placeholder({
  title,
  spec,
  phase,
  children,
}: {
  title: string;
  /** 対応する SPEC.md の節番号 (例: "§6.1") */
  spec: string;
  /** 実装予定フェーズ (SPEC §15) */
  phase: string;
  children?: React.ReactNode;
}) {
  return (
    <section className="mx-auto max-w-2xl px-4 py-8">
      <h1 className="text-xl font-bold">{title}</h1>
      <p className="mt-2 text-sm text-[var(--muted)]">
        SPEC.md {spec} — {phase} で実装
      </p>
      {children ? <div className="mt-6 text-sm">{children}</div> : null}
    </section>
  );
}
