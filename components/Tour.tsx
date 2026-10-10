"use client";

import { usePathname } from "next/navigation";
import { useCallback, useEffect, useLayoutEffect, useState } from "react";

/**
 * 初回ツアー (SPEC.md §6.7.9 / v1.30)
 *
 * 初めて開いたとき、**説明する部分以外を暗くして、吹き出しで順に案内する**。
 * 飛ばせる。見終わった印は端末に保存し、? ボタン (HelpButton) から見返せる。
 *
 * 指す先は `data-tour="..."` の付いた要素。**画面に無いものは飛ばす**
 * (OB には鍵のボードが無い・締切が無い日がある、など)。
 *
 * ライブラリ (driver.js 等) は使わない。やることは「穴の空いた幕」と
 * 「吹き出し」だけで、依存を増やすほどの量ではない。
 */

export const START_TOUR_EVENT = "app:start-tour";
export const TOUR_DONE_KEY = "tour-done-v1";

interface Step {
  target: string;
  title: string;
  body: string;
}

const STEPS: Step[] = [
  {
    target: "calendar",
    title: "カレンダー",
    body: "自分の練習・ナンバー・イベント・締切が1つのカレンダーにまとまっています。日付を押すと、その日の予定が下に出ます。",
  },
  {
    target: "day",
    title: "その日の予定",
    body: "自分の予定は濃く、ほかのジャンルの練習や空いている部屋は薄く出ます。予定を押すと出欠、「空き」を押すと申請ができます。",
  },
  {
    target: "room-board",
    title: "今日の練習場所",
    body: "鍵を開けた・閉めたら、ここで部屋を押して報告します。確認が出るので、間違えて押しても大丈夫です。",
  },
  {
    target: "deadlines",
    title: "近い締切",
    body: "集金やフォームの締切がここに出ます。締切の日の朝に通知も届きます。",
  },
  {
    target: "tabbar",
    title: "タブ",
    body: "「カレンダー」と「ナンバー」を切り替えます。ナンバーの作成や日程の登録は「ナンバー」から。",
  },
  {
    target: "settings",
    title: "設定",
    body: "通知のオン/オフ、自分のカレンダーアプリへの登録、画面の明るさはここから。",
  },
  {
    target: "help",
    title: "困ったら",
    body: "? からいつでもヒントを見られます。このツアーもここから見返せます。",
  },
];

const PADDING = 8;
/** 穴の高さの上限 (画面の高さに対する割合)。残りに吹き出しを置く */
const MAX_HOLE_RATIO = 0.45;

export function Tour() {
  const pathname = usePathname();
  const [steps, setSteps] = useState<Step[] | null>(null);
  const [index, setIndex] = useState(0);
  const [rect, setRect] = useState<DOMRect | null>(null);

  const start = useCallback(() => {
    const present = STEPS.filter((step) => {
      const element = document.querySelector(`[data-tour="${step.target}"]`);
      return element instanceof HTMLElement && element.offsetParent !== null;
    });
    if (present.length === 0) return;
    setSteps(present);
    setIndex(0);
  }, []);

  // 初めての起動 (またはヘルプから ?tour=1 で来た) ならカレンダーで始める
  useEffect(() => {
    // デモ画面のカレンダー (/demo/calendar) でも始められる
    if (pathname !== "/" && pathname !== "/demo/calendar") return;
    const requested = new URLSearchParams(window.location.search).has("tour");
    let done = false;
    try {
      done = localStorage.getItem(TOUR_DONE_KEY) === "1";
    } catch {
      // 保存が使えない環境では毎回出すとうるさいので出さない
      done = true;
    }
    if (done && !requested) return;
    // デモ画面では頼まれたとき (?tour=1) だけ始める。画面の見本を見るたびに出ると邪魔
    if (pathname !== "/" && !requested) return;
    // 起動アニメーションが終わってから始める (重なると読めない)
    const timer = window.setTimeout(start, requested ? 300 : 2200);
    return () => window.clearTimeout(timer);
  }, [pathname, start]);

  useEffect(() => {
    window.addEventListener(START_TOUR_EVENT, start);
    return () => window.removeEventListener(START_TOUR_EVENT, start);
  }, [start]);

  const step = steps?.[index] ?? null;

  // 指す先を画面の中ほどに送ってから、位置を測る
  useLayoutEffect(() => {
    if (!step) return;
    const element = document.querySelector<HTMLElement>(
      `[data-tour="${step.target}"]`,
    );
    if (!element) return;
    // 縦に長いもの (その日の予定など) は頭を画面の上に合わせ、穴は上の方だけ開ける。
    // 全体を囲むと穴が画面より大きくなり、吹き出しの置き場が無くなる
    const tall = element.offsetHeight > window.innerHeight * MAX_HOLE_RATIO;
    element.scrollIntoView({
      block: tall ? "start" : "center",
      behavior: "instant" as ScrollBehavior,
    });
    const measure = () => setRect(element.getBoundingClientRect());
    measure();
    window.addEventListener("resize", measure);
    window.addEventListener("scroll", measure, true);
    return () => {
      window.removeEventListener("resize", measure);
      window.removeEventListener("scroll", measure, true);
    };
  }, [step]);

  function finish() {
    try {
      localStorage.setItem(TOUR_DONE_KEY, "1");
    } catch {}
    setSteps(null);
    setRect(null);
    // ?tour=1 で来たときは URL から消す (再読み込みでまた始まらないように)
    const url = new URL(window.location.href);
    if (url.searchParams.has("tour")) {
      url.searchParams.delete("tour");
      window.history.replaceState(null, "", url.pathname + url.search);
    }
  }

  if (!steps || !step || !rect) return null;

  const last = index === steps.length - 1;
  const viewportHeight = window.innerHeight;
  const hole = {
    top: rect.top - PADDING,
    left: rect.left - PADDING,
    width: rect.width + PADDING * 2,
    height: Math.min(rect.height, viewportHeight * MAX_HOLE_RATIO) + PADDING * 2,
  };
  const below = hole.top + hole.height + 180 < viewportHeight || hole.top < 200;


  return (
    <div
      className="fixed inset-0 z-[60]"
      role="dialog"
      aria-modal="true"
      aria-label="使い方ツアー"
      data-no-swipe
    >
      {/* 穴の空いた幕。影を外側に大きく広げて、穴の外を暗くする */}
      <div
        aria-hidden
        className="pointer-events-none absolute rounded-2xl transition-all duration-300"
        style={{
          ...hole,
          boxShadow: "0 0 0 9999px rgba(0, 0, 0, 0.62)",
        }}
      />
      {/* 穴の中も含めて押せないようにする (ツアー中に画面が動かないように) */}
      <div className="absolute inset-0" />

      <div
        className="sheet-in absolute left-4 right-4 mx-auto max-w-sm rounded-2xl bg-[var(--background)] p-4 shadow-[0_10px_40px_rgba(0,0,0,0.35)]"
        style={
          below
            ? { top: Math.min(hole.top + hole.height + 12, viewportHeight - 190) }
            : { bottom: Math.max(viewportHeight - hole.top + 12, 16) }
        }
      >
        <p className="text-[13px] text-[var(--muted)]">
          {index + 1} / {steps.length}
        </p>
        <h2 className="mt-0.5 text-[17px] font-semibold">{step.title}</h2>
        <p className="mt-1 text-[15px] leading-relaxed">{step.body}</p>
        <div className="mt-3 flex items-center justify-between">
          <button
            type="button"
            onClick={finish}
            className="px-1 py-2 text-[15px] text-[var(--muted)]"
          >
            スキップ
          </button>
          <div className="flex gap-2">
            {index > 0 ? (
              <button
                type="button"
                onClick={() => setIndex(index - 1)}
                className="rounded-full bg-[var(--fill)] px-4 py-2 text-[15px] font-semibold text-[var(--tint)]"
              >
                戻る
              </button>
            ) : null}
            <button
              type="button"
              onClick={() => (last ? finish() : setIndex(index + 1))}
              className="rounded-full bg-[var(--tint)] px-5 py-2 text-[15px] font-semibold text-white"
            >
              {last ? "はじめる" : "次へ"}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
