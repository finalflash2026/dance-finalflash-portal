"use client";

import { useRouter } from "next/navigation";
import { useCallback, useEffect, useRef, useState, useTransition } from "react";

import { requestRefresh } from "@/lib/refresh-signal";

/**
 * 引っぱって更新 (SPEC.md §12 / v1.16)
 *
 * **ホーム画面から開いたときだけ効かせる。** ブラウザのタブでは同じ操作が
 * 元から用意されていて、両方が動くと二重に読み込む。standalone で開くと
 * その仕組みごと無くなるため、こちらで用意する。
 *
 * 拾ってはいけない場面をいくつか外している:
 *   - 一番上まで戻っていないとき … 普通の上スクロールと区別が付かない
 *   - 横に大きく動いたとき … タブの切り替え (SwipeTabs) と競合する
 *   - `[data-no-swipe]` の中 … モーダルを開いたまま背後が更新されると、
 *     閉じた先が別の画面になっている
 *
 * 取り直しは `router.refresh()` と `requestRefresh()` の**両方**を投げる。
 * 前者はサーバーが描いている部分、後者は自分で Supabase を引いている
 * 施錠ボードと部室の鍵ボード。片方だけだと、引っぱったのに鍵の状態が
 * 変わらない (lib/refresh-signal.ts)。
 */

/** これ以上引いたら更新する距離 */
const THRESHOLD_PX = 70;
/** 引ける上限。指なりに伸ばすと画面外まで動いてしまう */
const MAX_PULL_PX = 110;
/** 指の動きに対する追従の割合。1 だと軽すぎて誤爆する */
const RESISTANCE = 0.5;

export function PullToRefresh({ children }: { children: React.ReactNode }) {
  const router = useRouter();
  const [pull, setPull] = useState(0);
  const [pending, startTransition] = useTransition();
  const start = useRef<{ x: number; y: number; pulling: boolean } | null>(null);

  const refresh = useCallback(() => {
    // startTransition の中で呼ぶと、完了するまで pending が立つ。
    // これが無いと、押した瞬間に表示だけ戻って「効いたのか分からない」
    startTransition(() => router.refresh());
    requestRefresh();
  }, [router]);

  useEffect(() => {
    const standalone =
      window.matchMedia("(display-mode: standalone)").matches ||
      (navigator as Navigator & { standalone?: boolean }).standalone === true;
    // ブラウザのタブには元から同じ操作がある
    if (!standalone) return;

    function reset() {
      start.current = null;
      setPull(0);
    }

    function onTouchStart(event: TouchEvent) {
      if (event.touches.length !== 1 || window.scrollY > 0) {
        start.current = null;
        return;
      }
      const touch = event.touches[0];
      const target = touch.target as Element | null;
      if (target?.closest("[data-no-swipe]") != null) {
        start.current = null;
        return;
      }
      start.current = { x: touch.clientX, y: touch.clientY, pulling: false };
    }

    function onTouchMove(event: TouchEvent) {
      const from = start.current;
      if (!from) return;

      const touch = event.touches[0];
      const dy = touch.clientY - from.y;
      const dx = touch.clientX - from.x;

      // 上へ動かした / 横のほうが大きい / 途中でスクロールが動いた
      if (dy <= 0 || Math.abs(dx) > Math.abs(dy) || window.scrollY > 0) {
        if (from.pulling) reset();
        else start.current = null;
        return;
      }

      from.pulling = true;
      // **ここで止めないと画面ごと弾む。** passive: false で登録してある
      if (event.cancelable) event.preventDefault();
      setPull(Math.min(MAX_PULL_PX, dy * RESISTANCE));
    }

    function onTouchEnd() {
      const from = start.current;
      start.current = null;
      if (!from?.pulling) {
        setPull(0);
        return;
      }
      setPull((current) => {
        if (current >= THRESHOLD_PX) refresh();
        return 0;
      });
    }

    document.addEventListener("touchstart", onTouchStart, { passive: true });
    document.addEventListener("touchmove", onTouchMove, { passive: false });
    document.addEventListener("touchend", onTouchEnd, { passive: true });
    document.addEventListener("touchcancel", reset, { passive: true });
    return () => {
      document.removeEventListener("touchstart", onTouchStart);
      document.removeEventListener("touchmove", onTouchMove);
      document.removeEventListener("touchend", onTouchEnd);
      document.removeEventListener("touchcancel", reset);
    };
  }, [refresh]);

  const ready = pull >= THRESHOLD_PX;
  // 更新中は指を離しても出したままにする
  const offset = pending ? THRESHOLD_PX : pull;
  const visible = offset > 0;

  return (
    <>
      <div
        aria-hidden={!visible}
        className="pointer-events-none fixed inset-x-0 top-0 z-50 flex justify-center"
        style={{
          transform: `translateY(${offset - 44}px)`,
          opacity: visible ? Math.min(1, offset / THRESHOLD_PX) : 0,
          // 指を追っている間は追従させ、離したときだけ滑らかに戻す
          transition: start.current ? "none" : "transform 200ms, opacity 200ms",
        }}
      >
        <span className="glass flex h-9 w-9 items-center justify-center rounded-full">
          <RefreshIcon spinning={pending} ready={ready} />
        </span>
      </div>

      {/* 更新中であることを読み上げにも伝える */}
      <span role="status" aria-live="polite" className="sr-only">
        {pending ? "最新の状態を取得しています" : ""}
      </span>

      {children}
    </>
  );
}

/** 引ききると向きが変わり、更新中は回る */
function RefreshIcon({
  spinning,
  ready,
}: {
  spinning: boolean;
  ready: boolean;
}) {
  return (
    <svg
      width="18"
      height="18"
      viewBox="0 0 18 18"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden
      className={spinning ? "animate-spin" : ""}
      style={{
        transform: !spinning && ready ? "rotate(180deg)" : undefined,
        transition: "transform 150ms",
      }}
    >
      <path d="M15.5 9a6.5 6.5 0 1 1-1.9-4.6" />
      <path d="M15.5 1.5v4h-4" />
    </svg>
  );
}
