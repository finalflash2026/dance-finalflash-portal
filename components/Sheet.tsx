"use client";

import { useEffect, useId } from "react";

/**
 * 下から出る窓 (SPEC §12 / §6.7.8 / v1.30)
 *
 * 申請シート・出欠管理と同じ形を、新しく作る窓で使い回すための部品。
 * 背景を押す・Esc・右上の × のどれでも閉じられる。
 *
 * 既存の窓 (ClaimSheet / AttendanceSheet / BoardMessages) はそれぞれ事情
 * (キーボードへの追従など) を抱えているので、ここへは寄せていない。
 */
export function Sheet({
  title,
  onClose,
  children,
  footer,
  layerClassName = "z-50",
}: {
  title: string;
  onClose: () => void;
  children: React.ReactNode;
  /** 一番下に固定して置くボタン (スクロールしても見える) */
  footer?: React.ReactNode;
  /** 重なりの順。確認の窓 (ConfirmHost) は他の窓より上に出す */
  layerClassName?: string;
}) {
  const titleId = useId();

  useEffect(() => {
    function onKey(event: KeyboardEvent) {
      if (event.key === "Escape") onClose();
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  return (
    <div
      className={`backdrop-in fixed inset-0 ${layerClassName} flex items-end justify-center bg-black/40 sm:items-center`}
    >
      <button
        type="button"
        aria-label="閉じる"
        onClick={onClose}
        className="absolute inset-0 cursor-default"
      />
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        className="sheet-in safe-bottom relative z-10 flex max-h-[90dvh] w-full max-w-md flex-col rounded-t-[22px] bg-[var(--background)] sm:rounded-[22px]"
      >
        {/* つまみ。下から出る窓であることを形で示す (iOS と同じ) */}
        <span
          aria-hidden
          className="mx-auto mt-2 h-1 w-9 shrink-0 rounded-full bg-[var(--border)] sm:hidden"
        />
        <header className="flex shrink-0 items-center justify-between gap-2 px-5 pb-2 pt-3">
          <h2 id={titleId} className="text-[17px] font-semibold">
            {title}
          </h2>
          <button
            type="button"
            onClick={onClose}
            aria-label="閉じる"
            className="grid h-8 w-8 place-items-center rounded-full bg-[var(--fill)] text-[var(--muted)]"
          >
            <svg viewBox="0 0 24 24" width="14" height="14" aria-hidden>
              <path
                d="M6 6l12 12M18 6L6 18"
                stroke="currentColor"
                strokeWidth="2.6"
                strokeLinecap="round"
              />
            </svg>
          </button>
        </header>
        <div className="min-h-0 flex-1 overflow-y-auto px-5 pb-4">{children}</div>
        {footer ? (
          <div className="shrink-0 border-t border-[var(--separator)] px-5 py-3">
            {footer}
          </div>
        ) : null}
      </div>
    </div>
  );
}
