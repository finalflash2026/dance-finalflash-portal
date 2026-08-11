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
  "w-full rounded-lg bg-[var(--foreground)] px-4 py-3 text-base font-bold text-white disabled:opacity-50";

export const secondaryButtonClass =
  "w-full rounded-lg border border-[var(--border)] px-4 py-3 text-base font-medium disabled:opacity-50";

export function ErrorMessage({ children }: { children?: React.ReactNode }) {
  if (!children) return null;
  return (
    <p
      role="alert"
      className="rounded-lg bg-[#FDECEA] px-3 py-2 text-sm text-[#8B1A10]"
    >
      {children}
    </p>
  );
}
