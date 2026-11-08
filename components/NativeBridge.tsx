"use client";

import { useEffect } from "react";

import { appUrlToPath, isNativeApp } from "@/lib/native";

/**
 * iOS アプリの中でだけ動く橋渡し (SPEC.md §2.3 / v1.37)。
 *
 * Google でログインしたあと、アプリ内の Safari から `ffcalendar://auth/callback`
 * で戻ってくる。その Safari を閉じ、WebView で `/auth/callback` を開いて
 * セッションを作る。Web のブラウザでは何もしない。
 */
export function NativeBridge() {
  useEffect(() => {
    if (!isNativeApp()) return;
    let removed = false;
    let remove: (() => void) | undefined;

    void (async () => {
      const [{ App }, { Browser }] = await Promise.all([
        import("@capacitor/app"),
        import("@capacitor/browser"),
      ]);
      const handle = await App.addListener("appUrlOpen", ({ url }) => {
        const path = appUrlToPath(url);
        if (!path) return;
        void Browser.close().catch(() => {});
        window.location.assign(path);
      });
      if (removed) void handle.remove();
      else remove = () => void handle.remove();
    })();

    return () => {
      removed = true;
      remove?.();
    };
  }, []);

  return null;
}
