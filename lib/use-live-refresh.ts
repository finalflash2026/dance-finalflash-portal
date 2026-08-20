"use client";

import { useEffect } from "react";

/**
 * 掲示板系カードの自動再取得 (SPEC.md §6.1.1 / §6.1.2 / v1.14)
 *
 * 施錠状況ボードと部室の鍵ボードは、**他人がその場で変える情報**を出している。
 * 開いたまま置いておくと古い値を見せ続けるので、短い間隔で取り直す。
 *
 * 4つの挙動をまとめてある:
 *   1. **マウントした時点で取り直す** (v1.14.1)
 *   2. 一定間隔で取り直す (既定15秒)
 *   3. **画面が隠れている間は止める**。バックグラウンドのタブが叩き続けても
 *      誰も見ていないので、通信とバッテリーの無駄にしかならない
 *   4. **戻ってきた瞬間に1回取り直す**。ポケットから出した直後に
 *      古い値が見えるのが一番まずいため、次の間隔を待たない
 *
 * 1 が要るのは**ルーターキャッシュ (§13.1) と噛み合わないから**。タブを
 * 移って30秒以内に戻ると、Next はサーバーに問い合わせず前回のRSCペイロードを
 * そのまま使う。つまりカードに渡ってくる初期値が最大30秒前のもので、
 * そこから間隔を待つと**最大45秒前の鍵の状態**が出たままになる。
 * これは実際に「戻ったら開錠の連絡が消えていた」として報告された。
 *
 * カードは自前で Supabase を引くので、マウント時に1回引けばキャッシュの
 * 齢に関係なく本当の今が出る。ページ全体を取り直す (`router.refresh()`) より
 * はるかに軽く、**速さのためのキャッシュを保ったまま鮮度だけ戻せる**。
 * 初回表示ではサーバー描画の直後にもう1回引くことになるが、
 * 小さなクエリ2本ぶんで、鮮度と引き換えにするには安い。
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

    // 隠れた状態で開かれることもある (別タブで開いておくなど)。
    // その場合は取りにいかない — 見えていないうちは古くても困らず、
    // 表になった時点で onVisible が取り直す
    if (document.visibilityState === "visible") {
      refresh();
      start();
    }

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
