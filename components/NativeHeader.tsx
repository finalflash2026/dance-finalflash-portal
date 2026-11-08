"use client";

import { usePathname } from "next/navigation";
import { useEffect } from "react";

import { isNativeApp } from "@/lib/native";
import { FFNative, type NativeHeaderButton } from "@/lib/native-plugin";

/**
 * iOS アプリの右上の丸ボタンと戻る (SPEC.md §2.3.1 / v1.41)
 *
 * アプリでは **iOS 26 の本物の Liquid Glass のボタン** (UIButton.Configuration.glass)
 * を同じ位置に重ねる。Web のボタン (`[data-header-action]`) は場所を空けたまま隠し、
 * ネイティブのボタンが押されたらその要素を押す。戻る先の決め方・設定の開け閉め・
 * 使い方の窓などは Web のボタンの動きがそのまま使われる。
 *
 * 窓 (role=dialog) が開いている間と起動アニメーションの間はしまう (タブバーと同じ)。
 */
const SYMBOLS: Record<string, string> = {
  bell: "bell",
  help: "questionmark",
  settings: "gearshape",
};

export function NativeHeader() {
  const pathname = usePathname();

  useEffect(() => {
    if (!isNativeApp()) return;
    let lastKey = "";
    let frame = 0;

    const send = () => {
      const splash = document.documentElement.dataset.splash;
      const blocked =
        document.querySelector('[role="dialog"][aria-modal="true"]') !== null ||
        !(splash === "off" || splash === "done");
      const backEl = document.querySelector<HTMLElement>('[data-header-action="back"]');
      const right: NativeHeaderButton[] = [...document.querySelectorAll<HTMLElement>(
        '[data-header-action]:not([data-header-action="back"])',
      )].map((el) => {
        const id = el.dataset.headerAction ?? "";
        return {
          id,
          symbol: SYMBOLS[id] ?? "circle",
          label: el.getAttribute("aria-label") ?? id,
          badge: Number(el.dataset.headerBadge ?? 0),
        };
      });
      const header = {
        visible: !blocked,
        back: backEl ? { label: backEl.dataset.headerLabel ?? "戻る" } : null,
        right,
        dark: document.documentElement.dataset.theme === "dark",
        tint: getComputedStyle(document.documentElement).getPropertyValue("--tint").trim(),
      };
      const key = JSON.stringify(header);
      if (key === lastKey) return;
      lastKey = key;
      void FFNative.setHeader(header).catch(() => {});
    };

    send();
    const schedule = () => {
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(send);
    };
    const observer = new MutationObserver(schedule);
    observer.observe(document.body, {
      childList: true,
      subtree: true,
      attributes: true,
      attributeFilter: ["role", "aria-modal", "data-header-badge", "data-header-label"],
    });
    const rootObserver = new MutationObserver(schedule);
    rootObserver.observe(document.documentElement, { attributeFilter: ["data-theme", "data-splash"] });

    let handle: { remove: () => Promise<void> } | undefined;
    let cancelled = false;
    void FFNative.addListener("headerTap", ({ id }) => {
      document.querySelector<HTMLElement>(`[data-header-action="${CSS.escape(id)}"]`)?.click();
    }).then((h) => {
      if (cancelled) void h.remove();
      else handle = h;
    });

    return () => {
      cancelled = true;
      cancelAnimationFrame(frame);
      observer.disconnect();
      rootObserver.disconnect();
      void handle?.remove();
      // ログアウトなどで (app) の外へ出たらしまう
      void FFNative.setHeader({ visible: false, back: null, right: [] }).catch(() => {});
    };
  }, [pathname]);

  return null;
}
