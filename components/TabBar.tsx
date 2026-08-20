"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

import { rememberNavDirection } from "@/lib/nav-direction";
import type { Role } from "@/lib/types";

/**
 * 下部タブバー (SPEC.md §6.0 / §7 / §12)
 *
 * 現役: マイカレンダー / 全体カレンダー / ナンバー の3タブ
 * OB  : 全体を表示せず 2タブ構成 (SPEC §6.0 / §3.6)
 *
 * **左端がマイカレンダーで、URL も `/`**(v1.14)。毎日開くのがここなので、
 * 起動して最初に出る画面にしてある。全体カレンダーは `/overview`。
 *
 * 見た目は**画面から浮いた島型**(v1.14)。下の内容が透けて動くことで、
 * 画面の一部ではなく上に乗っているものだと分かる。
 *
 * 表示の出し分けは補助であり、認可の最終防衛線は RLS (SPEC §13.2)。
 */

export const TABS = [
  { href: "/", label: "マイ", hiddenForOb: false },
  { href: "/overview", label: "全体", hiddenForOb: true },
  { href: "/number-cal", label: "ナンバー", hiddenForOb: false },
] as const;

/** OB は全体カレンダーを持たない。スワイプ側 (SwipeTabs) とも共用する */
export function visibleTabs(role: Role) {
  return TABS.filter((tab) => !(role === "ob" && tab.hiddenForOb));
}

export function TabBar({ role }: { role: Role }) {
  const pathname = usePathname();
  const tabs = visibleTabs(role);
  const currentIndex = tabs.findIndex((tab) => tab.href === pathname);

  return (
    <nav
      className="fixed inset-x-0 bottom-[calc(env(safe-area-inset-bottom)+10px)] z-40 flex justify-center px-4"
      aria-label="メインナビゲーション"
    >
      <ul className="glass flex gap-1 rounded-full p-1">
        {tabs.map((tab, index) => {
          const active = index === currentIndex;
          return (
            <li key={tab.href}>
              <Link
                href={tab.href}
                /*
                 * **明示しないと効かない。** 動的ルートの既定の先読みは
                 * loading 境界までで止まり、中身の RSC ペイロードを取らない
                 * ((calendar)/loading.tsx の注記と同じ理由)。
                 * 3タブぶんでも数十KBなので、先に取ってしまうほうが速い。
                 */
                prefetch
                // 遷移アニメーションの向きを決める (lib/nav-direction.ts)
                onClick={() => rememberNavDirection(currentIndex, index)}
                aria-current={active ? "page" : undefined}
                // 高さ44pxは指で押せる最小 (SPEC §12: スマホ最優先)
                className={`flex h-11 min-w-[76px] items-center justify-center rounded-full px-4 text-sm transition-colors ${
                  active
                    ? "bg-[var(--primary)] font-bold text-[var(--primary-fg)]"
                    : "text-[var(--muted)]"
                }`}
              >
                {tab.label}
              </Link>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}
