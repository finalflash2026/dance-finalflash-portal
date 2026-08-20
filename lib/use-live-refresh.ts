"use client";

import { useEffect } from "react";

/**
 * 掲示板系カードの自動再取得 (SPEC.md §6.1.1 / §6.1.2 / v1.14)
 *
 * 施錠状況ボードと部室の鍵ボードは、**他人がその場で変える情報**を出している。
 * 開いたまま置いておくと古い値を見せ続けるので、短い間隔で取り直す。
 *
 * 3つの挙動をまとめてある:
 *   1. 一定間隔で取り直す (既定15秒)
 *   2. **画面が隠れている間は止める**。バックグラウンドのタブが叩き続けても
 *      誰も見ていないので、通信とバッテリーの無駄にしかならない
 *   3. **戻ってきた瞬間に1回取り直す**。ポケットから出した直後に
 *      古い値が見えるのが一番まずいため、次の間隔を待たない
 */
export function useLiveRefresh(
  refresh: () => void,
  intervalMs = 15_000,
): void {
  useEffect(() => {
    let timer: ReturnType<typeof setInterval> | null = null;

    const stop = () => {
      if (timer !== null) {
        clearInterval(timer);
        timer = null;
      }
    };

    const start = () => {
      stop();
      timer = setInterval(refresh, intervalMs);
    };

    const onVisible = () => {
      if (document.visibilityState === "visible") {
        refresh();
        start();
      } else {
        stop();
      }
    };

    // 隠れた状態で開かれることもある (別タブで開いておくなど)
    if (document.visibilityState === "visible") start();

    document.addEventListener("visibilitychange", onVisible);
    // iOS はタブ切り替えで visibilitychange が来ないことがあるので focus も見る
    window.addEventListener("focus", onVisible);

    return () => {
      stop();
      document.removeEventListener("visibilitychange", onVisible);
      window.removeEventListener("focus", onVisible);
    };
  }, [refresh, intervalMs]);
}
