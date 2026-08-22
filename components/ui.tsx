/**
 * フォーム系の共通パーツ。
 * デザインシステムを作り込む段階ではないので、Tailwind のクラスをここに集約して
 * 画面側の記述を短く保つことだけを目的にしている。
 */

export function Field({
  label,
  hint,
  children,
}: {
  label: string;
  hint?: string;
  children: React.ReactNode;
}) {
  return (
    <label className="block">
      <span className="text-sm font-medium">{label}</span>
      {children}
      {hint ? (
        <span className="mt-1 block text-xs text-[var(--muted)]">{hint}</span>
      ) : null}
    </label>
  );
}

export const inputClass =
  "mt-1 w-full rounded-lg border border-[var(--border)] bg-[var(--background)] px-3 py-2 text-base outline-none focus:border-[var(--foreground)]";

export const buttonClass =
  "w-full rounded-lg bg-[var(--primary)] px-4 py-3 text-base font-bold text-[var(--primary-fg)] disabled:opacity-50";

export const secondaryButtonClass =
  "w-full rounded-lg border border-[var(--border)] px-4 py-3 text-base font-medium disabled:opacity-50";

/**
 * 設定画面の各項目を囲む枠 (SPEC §6.4.1 / §12 / v1.18.1)
 *
 * 以前は見出しと余白だけで区切っていたが、**どこからどこまでが1項目なのか
 * ぱっと見で分からない**という指摘が出た。掲示板カード (§6.1.1) と同じ枠に
 * 揃えて、画面全体で「囲まれているもの = ひとまとまり」と読めるようにする。
 */
export const settingsSectionClass =
  "space-y-3 rounded-xl border border-[var(--border)] p-4";

export function ErrorMessage({ children }: { children?: React.ReactNode }) {
  if (!children) return null;
  return (
    <p
      role="alert"
      className="rounded-lg bg-[var(--danger-bg)] px-3 py-2 text-sm text-[var(--danger-fg)]"
    >
      {children}
    </p>
  );
}
