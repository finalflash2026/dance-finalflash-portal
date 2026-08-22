"use client";

import { useEffect } from "react";

/**
 * Service Worker の登録 (SPEC.md §13.1 / v1.18)
 *
 * **通知を使わない人にも登録する。** v1.15 では設定画面で通知をオンにした
 * ときだけ登録していたが、Service Worker の役割が「静的ファイルを持っておく」
 * にも広がったため、全員に効かせたい (public/sw.js)。
 *
 * 何も描画しない。置き場所は `(app)/layout.tsx` で、ログイン後の全画面で
 * 一度だけ走る。既に登録済みならブラウザ側で何も起きない。
 *
 * 失敗しても**握り潰す**。Service Worker はあくまで速くするためのもので、
 * 使えない環境 (未対応ブラウザ・プライベートブラウズ) でもアプリは
 * これまで通り動く。ここでエラーを出しても利用者にできることが無い。
 */
export function ServiceWorkerRegistrar() {
  useEffect(() => {
    if (!("serviceWorker" in navigator)) return;

    // 起動直後は取りにいくものが多い。登録は後回しにして邪魔をしない
    const timer = setTimeout(() => {
      navigator.serviceWorker.register("/sw.js").catch((cause) => {
        console.error("[sw] 登録できませんでした", cause);
      });
    }, 1500);

    return () => clearTimeout(timer);
  }, []);

  return null;
}
