"use client";

import { useRouter } from "next/navigation";
import { usePathname } from "next/navigation";
import { useEffect, useRef } from "react";

import { rememberNavDirection } from "@/lib/nav-direction";
import { visibleTabs } from "@/components/TabBar";
import type { Role } from "@/lib/types";

/**
 * 横スワイプでのタブ移動 (SPEC.md §6.0 / §12 / v1.14)
 *
 * 指に追従はさせず、**離した時点で隣のタブへ移る**。追従させるには3画面ぶんの
 * データを同時に持つ必要があり、初回表示が重くなるため採らなかった。
 *
 * **拾ってはいけない場所がある**:
 *   - `.h-scroll` の中 … 日別グリッドや取込タイムラインは横スクロールする。
 *     ここで拾うと表を動かせなくなる
 *   - `[data-no-swipe]` … モーダルの中。背後の画面が変わってしまう
 *   - 2本指以上 … 拡大操作
 */
export function SwipeTabs({
  role,
  children,
}: {
  role: Role;
  children: React.ReactNode;
}) {
  const router = useRouter();
  const pathname = usePathname();
  const start = useRef<{ x: number; y: number; ignore: boolean } | null>(null);

  useEffect(() => {
    const tabs = visibleTabs(role);
    const index = tabs.findIndex((tab) => tab.href === pathname);
    // タブ以外の画面 (設定・折衝・管理など) ではスワイプを効かせない
    if (index < 0) return;

    /** 横に振れたと見なす距離。小さくすると縦スクロールの揺れで誤爆する */
    const THRESHOLD_PX = 60;

    function onTouchStart(event: TouchEvent) {
      if (event.touches.length !== 1) {
        start.current = null;
        return;
      }
      const touch = event.touches[0];
      const target = touch.target as Element | null;
      start.current = {
        x: touch.clientX,
        y: touch.clientY,
        ignore: target?.closest(".h-scroll, [data-no-swipe]") != null,
      };
    }

    function onTouchEnd(event: TouchEvent) {
      const from = start.current;
      start.current = null;
      if (!from || from.ignore) return;

      const touch = event.changedTouches[0];
      const dx = touch.clientX - from.x;
      const dy = touch.clientY - from.y;

      // 縦のほうが大きければスクロールの意図とみなす
      if (Math.abs(dx) < THRESHOLD_PX || Math.abs(dx) < Math.abs(dy) * 1.5) {
        return;
      }

      // 左へ払う = 右のタブへ
      const next = dx < 0 ? index + 1 : index - 1;
      if (next < 0 || next >= tabs.length) return;

      rememberNavDirection(index, next);
      router.push(tabs[next].href);
    }

    document.addEventListener("touchstart", onTouchStart, { passive: true });
    document.addEventListener("touchend", onTouchEnd, { passive: true });
    return () => {
      document.removeEventListener("touchstart", onTouchStart);
      document.removeEventListener("touchend", onTouchEnd);
    };
  }, [pathname, role, router]);

  return <>{children}</>;
}
