"use client";

import { useState } from "react";

/**
 * 設定の1ブロック (SPEC §6.4.1 / v1.31.9)。
 *
 * **最初は閉じておき、押すと中身が開く。** 全部を開いたまま縦に並べていたときは、
 * 目当ての設定まで長くスクロールする必要があった。閉じた行には
 * 今の値 (「POP」「オン」など) を出すので、開かなくても状態は分かる。
 *
 * 説明の文は `hint` に渡すと、見出しの横の ? を押したときだけ出る。
 * 細かい文字が画面に並び続けると読みにくい、という声を受けた。
 */
export function SettingsGroup({
  title,
  summary,
  hint,
  defaultOpen = false,
  tour,
  children,
}: {
  title: string;
  /** 閉じているときに右に出す今の値 */
  summary?: React.ReactNode;
  hint?: React.ReactNode;
  defaultOpen?: boolean;
  /** 初回ツアーの目印 (data-tour) */
  tour?: string;
  children: React.ReactNode;
}) {
  const [open, setOpen] = useState(defaultOpen);
  const [showHint, setShowHint] = useState(false);

  return (
    <section className="rounded-xl bg-[var(--cell)]" data-tour={tour}>
      <div className="flex items-center gap-1 pr-2">
        <button
          type="button"
          onClick={() => setOpen((value) => !value)}
          aria-expanded={open}
          className="flex min-h-[52px] min-w-0 flex-1 items-center gap-3 py-3 pl-4 text-left"
        >
          <span className="shrink-0 text-[17px] font-semibold">{title}</span>
          <span className="min-w-0 flex-1 truncate text-right text-[15px] text-[var(--muted)]">
            {open ? null : summary}
          </span>
        </button>
        {hint ? (
          <HintButton open={showHint} onToggle={() => setShowHint((value) => !value)} label={title} />
        ) : null}
        <button
          type="button"
          onClick={() => setOpen((value) => !value)}
          aria-hidden
          tabIndex={-1}
          className="grid h-11 w-8 shrink-0 place-items-center text-[var(--muted)]"
        >
          <svg
            viewBox="0 0 14 8"
            width="13"
            height="8"
            className={`transition-transform duration-300 ${open ? "rotate-180" : ""}`}
          >
            <path
              d="M1 1l6 6 6-6"
              fill="none"
              stroke="currentColor"
              strokeWidth="2.2"
              strokeLinecap="round"
            />
          </svg>
        </button>
      </div>

      {hint && showHint ? <HintBox>{hint}</HintBox> : null}

      {/* 高さをなめらかに伸ばす (grid 0fr ↔ 1fr) */}
      <div
        className={`grid transition-[grid-template-rows] duration-300 ${
          open ? "grid-rows-[1fr]" : "grid-rows-[0fr]"
        }`}
      >
        <div className="overflow-hidden">
          <div className="space-y-3 px-4 pb-4">{open ? children : null}</div>
        </div>
      </div>
    </section>
  );
}

/** 見出しの横の ? 。押すと説明を出す (指で押せるよう周りを広めに取る) */
export function HintButton({
  open,
  onToggle,
  label,
}: {
  open: boolean;
  onToggle: () => void;
  label: string;
}) {
  return (
    <button
      type="button"
      onClick={onToggle}
      aria-expanded={open}
      aria-label={`${label}の説明`}
      className="grid h-11 w-11 shrink-0 place-items-center"
    >
      <span
        aria-hidden
        className={`grid h-6 w-6 place-items-center rounded-full text-[13px] font-bold ${
          open ? "bg-[var(--tint)] text-white" : "bg-[var(--fill)] text-[var(--tint)]"
        }`}
      >
        ?
      </span>
    </button>
  );
}

export function HintBox({ children }: { children: React.ReactNode }) {
  return (
    <div className="mx-4 mb-3 rounded-lg bg-[var(--fill)] px-3 py-2.5 text-[15px] leading-relaxed">
      {children}
    </div>
  );
}

/** 見出しと ? の組 (ブロックの中の項目用)。押すと下に説明が出る */
export function LabelWithHint({ label, hint }: { label: string; hint: React.ReactNode }) {
  const [open, setOpen] = useState(false);
  return (
    <div>
      <div className="-my-2 flex items-center">
        <span className="text-[15px] font-semibold">{label}</span>
        <HintButton open={open} onToggle={() => setOpen((value) => !value)} label={label} />
      </div>
      {open ? (
        <div className="mt-1 rounded-lg bg-[var(--fill)] px-3 py-2.5 text-[15px] leading-relaxed">
          {hint}
        </div>
      ) : null}
    </div>
  );
}
