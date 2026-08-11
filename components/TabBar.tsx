"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

import type { Role } from "@/lib/types";

/**
 * 下部固定タブバー (SPEC.md §6.0 / §7)
 *
 * 現役: ①全体カレンダー / ②ナンバー / ③マイカレンダー の3タブ
 * OB  : タブ①を表示せず ②③ の2タブ構成 (SPEC §6.0 / §3.6)
 *
 * 表示の出し分けは補助であり、認可の最終防衛線は RLS (SPEC §13.2)。
 */

const TABS = [
  { href: "/", label: "全体", hiddenForOb: true },
  { href: "/number-cal", label: "ナンバー", hiddenForOb: false },
  { href: "/me", label: "マイ", hiddenForOb: false },
] as const;

export function TabBar({ role }: { role: Role }) {
  const pathname = usePathname();
  const tabs = TABS.filter((tab) => !(role === "ob" && tab.hiddenForOb));

  return (
    <nav
      className="fixed inset-x-0 bottom-0 z-40 border-t border-[var(--border)] bg-[var(--background)] pb-[env(safe-area-inset-bottom)]"
      aria-label="メインナビゲーション"
    >
      <ul className="mx-auto flex max-w-2xl">
        {tabs.map((tab) => {
          const active = pathname === tab.href;
          return (
            <li key={tab.href} className="flex-1">
              <Link
                href={tab.href}
                aria-current={active ? "page" : undefined}
                className={`flex h-14 items-center justify-center text-sm ${
                  active
                    ? "font-bold text-[var(--foreground)]"
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
