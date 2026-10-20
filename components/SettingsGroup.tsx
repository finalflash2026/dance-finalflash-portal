"use client";

import { useEffect, useLayoutEffect, useRef, useState } from "react";

/**
 * 設定の1枚のカード (SPEC §6.4.1 / v1.31.9 → v1.31.11)。
 *
 * **カードを2列に並べ、押すとカードが画面いっぱいに広がって開く** (v1.31.12)。
 * 左上の「‹」で元のカードへ縮んで閉じる。カードの位置から広げるので、
 * どのカードを開いたのか・どこへ戻るのかが目で追える (v1.31.11 は下から出る窓だった)。
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
  /** closed → opening (カードの位置) → open (全画面) → closing (カードへ戻る) */
  const [phase, setPhase] = useState<"closed" | "opening" | "open" | "closing">("closed");
  const [rect, setRect] = useState<DOMRect | null>(null);
  const [showHint, setShowHint] = useState(false);
  const cardRef = useRef<HTMLButtonElement>(null);

  function open() {
    if (!cardRef.current) return;
    setRect(cardRef.current.getBoundingClientRect());
    setPhase("opening");
  }
  function close() {
    // 開いている間にスクロールで位置が変わることは無いが、念のため測り直す
    if (cardRef.current) setRect(cardRef.current.getBoundingClientRect());
    setPhase("closing");
  }

  // opening の1コマ目はカードの位置で描き、次のコマで全画面へ伸ばす (CSS の transition)
  useLayoutEffect(() => {
    if (phase !== "opening") return;
    const id = requestAnimationFrame(() => requestAnimationFrame(() => setPhase("open")));
    return () => cancelAnimationFrame(id);
  }, [phase]);

  useEffect(() => {
    if (phase !== "closing") return;
    const timer = window.setTimeout(() => {
      setPhase("closed");
      setShowHint(false);
    }, DURATION);
    return () => window.clearTimeout(timer);
  }, [phase]);

  // 開いている間は後ろの画面を動かさない
  useEffect(() => {
    if (phase === "closed") return;
    const previous = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = previous;
    };
  }, [phase]);

  const expanded = phase === "open";
  const panelStyle: React.CSSProperties =
    expanded || !rect
      ? { top: 0, left: 0, width: "100vw", height: "100dvh", borderRadius: 0 }
      : { top: rect.top, left: rect.left, width: rect.width, height: rect.height, borderRadius: 16 };

  return (
    <>
      <button
        ref={cardRef}
        type="button"
        onClick={open}
        data-tour={tour}
        className={`flex min-h-[88px] flex-col items-start gap-1.5 rounded-2xl bg-[var(--cell)] p-3 text-left active:scale-[0.97] transition-transform ${
          phase === "closed" ? "" : "invisible"
        }`}
      >
        <CardFace icon={icon} title={title} summary={summary} />
      </button>

      {phase !== "closed" ? (
        <div
          role="dialog"
          aria-modal="true"
          aria-label={title}
          data-no-swipe
          className="fixed z-[70] overflow-hidden bg-[var(--background)] shadow-[0_10px_40px_rgba(0,0,0,0.35)]"
          style={{
            ...panelStyle,
            transition: `all ${DURATION}ms cubic-bezier(0.32, 0.72, 0, 1)`,
          }}
        >
          {/* 広がる途中はカードの見た目のまま。開ききったら中身に入れ替える */}
          <div
            className="absolute inset-0 flex flex-col items-start gap-1.5 bg-[var(--cell)] p-3"
            style={{ opacity: expanded ? 0 : 1, transition: `opacity ${DURATION / 2}ms`, pointerEvents: "none" }}
          >
            <CardFace icon={icon} title={title} summary={summary} />
          </div>
          <div
            className="flex h-full flex-col"
            style={{ opacity: expanded ? 1 : 0, transition: `opacity ${DURATION}ms` }}
          >
            <header className="flex shrink-0 items-center gap-2 px-4 pb-2 pt-[max(env(safe-area-inset-top),12px)]">
              <button
                type="button"
                onClick={close}
                aria-label="閉じる"
                className="grid h-11 w-11 place-items-center rounded-full bg-[var(--fill)] text-[var(--tint)] active:opacity-60"
              >
                <svg viewBox="0 0 10 18" width="10" height="17" aria-hidden>
                  <path
                    d="M8.5 1.5L1.5 9l7 7.5"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="2.4"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                  />
                </svg>
              </button>
              <span className="grid h-8 w-8 place-items-center rounded-lg bg-[var(--fill)] text-[var(--tint)]">
                <Icon name={icon} />
              </span>
              <h2 className="min-w-0 flex-1 truncate text-[20px] font-bold">{title}</h2>
            </header>
            <div className="min-h-0 flex-1 overflow-y-auto px-4 pb-[max(env(safe-area-inset-bottom),24px)] pt-2">
              <div className="mx-auto max-w-2xl space-y-4">
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
                {phase === "open" || phase === "closing" ? children : null}
              </div>
            </div>
          </div>
        </div>
      ) : null}
    </>
  );
}

/** 開閉の長さ (ms)。iOS の画面の出入りに近い速さ */
const DURATION = 380;

function CardFace({
  icon,
  title,
  summary,
}: {
  icon: SettingsIcon;
  title: string;
  summary?: React.ReactNode;
}) {
  return (
    <>
      <span className="grid h-8 w-8 place-items-center rounded-lg bg-[var(--fill)] text-[var(--tint)]">
        <Icon name={icon} />
      </span>
      <span className="w-full">
        <span className="block text-[16px] font-semibold leading-snug">{title}</span>
        {summary ? (
          <span className="block truncate text-[14px] text-[var(--muted)]">{summary}</span>
        ) : null}
      </span>
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
