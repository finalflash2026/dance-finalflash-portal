"use client";

import { useState } from "react";

import { Sheet } from "@/components/Sheet";

/**
 * 設定の1枚のカード (SPEC §6.4.1 / v1.31.9 → v1.31.11)。
 *
 * **カードを2列に並べ、押すと下から窓が開いて中身を出す** (v1.31.11)。
 * v1.31.9 の「閉じた行を押すと開く」形は、開いたブロックが下を押し下げて
 * 位置が動き、見づらかった。カードには絵・見出し・今の値 (「POP」「オン」など) を出し、
 * 開かなくても状態が分かるようにする。
 *
 * 説明の文は `hint` に渡すと、窓の上の ? を押したときだけ出る。
 */
export type SettingsIcon = "account" | "genre" | "calendar" | "bell" | "layout" | "theme" | "key";

export function SettingsGroup({
  title,
  summary,
  hint,
  icon,
  tour,
  children,
}: {
  title: string;
  /** カードに出す今の値 */
  summary?: React.ReactNode;
  hint?: React.ReactNode;
  icon: SettingsIcon;
  /** 初回ツアーの目印 (data-tour) */
  tour?: string;
  children: React.ReactNode;
}) {
  const [open, setOpen] = useState(false);
  const [showHint, setShowHint] = useState(false);

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        data-tour={tour}
        className="flex min-h-[88px] flex-col items-start gap-1.5 rounded-2xl bg-[var(--cell)] p-3 text-left active:opacity-70"
      >
        <span className="grid h-8 w-8 place-items-center rounded-lg bg-[var(--fill)] text-[var(--tint)]">
          <Icon name={icon} />
        </span>
        <span className="w-full">
          <span className="block text-[16px] font-semibold leading-snug">{title}</span>
          {summary ? (
            <span className="block truncate text-[14px] text-[var(--muted)]">{summary}</span>
          ) : null}
        </span>
      </button>

      {open ? (
        <Sheet
          title={title}
          onClose={() => {
            setOpen(false);
            setShowHint(false);
          }}
        >
          <div className="space-y-4">
            {hint ? (
              <div>
                <button
                  type="button"
                  onClick={() => setShowHint((value) => !value)}
                  aria-expanded={showHint}
                  className="-ml-1 flex h-11 items-center gap-2 px-1 text-[15px] text-[var(--tint)]"
                >
                  <span
                    aria-hidden
                    className={`grid h-6 w-6 place-items-center rounded-full text-[13px] font-bold ${
                      showHint ? "bg-[var(--tint)] text-white" : "bg-[var(--fill)]"
                    }`}
                  >
                    ?
                  </span>
                  この設定について
                </button>
                {showHint ? <HintBox>{hint}</HintBox> : null}
              </div>
            ) : null}
            {children}
          </div>
        </Sheet>
      ) : null}
    </>
  );
}

export function HintBox({ children }: { children: React.ReactNode }) {
  return (
    <div className="rounded-lg bg-[var(--fill)] px-3 py-2.5 text-[15px] leading-relaxed">
      {children}
    </div>
  );
}

function Icon({ name }: { name: SettingsIcon }) {
  const paths: Record<SettingsIcon, React.ReactNode> = {
    account: (
      <>
        <circle cx="12" cy="8" r="4" />
        <path d="M4 21a8 8 0 0 1 16 0" />
      </>
    ),
    genre: (
      <>
        <circle cx="7" cy="17" r="3" />
        <circle cx="17" cy="15" r="3" />
        <path d="M10 17V5l10-2v12" />
      </>
    ),
    calendar: (
      <>
        <rect x="3" y="5" width="18" height="16" rx="2" />
        <path d="M3 10h18M8 3v4M16 3v4" />
      </>
    ),
    bell: (
      <>
        <path d="M6 8a6 6 0 0 1 12 0c0 7 3 9 3 9H3s3-2 3-9" />
        <path d="M10.3 21a1.94 1.94 0 0 0 3.4 0" />
      </>
    ),
    layout: (
      <>
        <rect x="3" y="3" width="18" height="7" rx="1.5" />
        <rect x="3" y="14" width="18" height="7" rx="1.5" />
      </>
    ),
    theme: (
      <>
        <circle cx="12" cy="12" r="9" />
        <path d="M12 3a9 9 0 0 0 0 18z" fill="currentColor" />
      </>
    ),
    key: (
      <>
        <circle cx="7.5" cy="15.5" r="4.5" />
        <path d="M10.7 12.3L20 3M16 7l3 3M14 9l2 2" />
      </>
    ),
  };
  return (
    <svg
      viewBox="0 0 24 24"
      width="20"
      height="20"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.9"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden
    >
      {paths[name]}
    </svg>
  );
}
