"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

import { rememberNavDirection } from "@/lib/nav-direction";

/**
 * 運営の画面の切り替え (SPEC.md §7 / v1.39)
 *
 * 折衝・割り振り・イベント・管理者の4画面を、上の1本の切り替えでつなぐ。
 * 以前は設定の中にボタンが4つ並び、画面どうしは行き来できなかった。
 * 置き場所はレイアウト (画面の入れ替えの外) なので、移っても動かない。
 * 運営の画面でだけ出る。
 */
const ITEMS = [
  { href: "/coordinator", label: "折衝" },
  { href: "/schedule/plan", label: "割り振り" },
  { href: "/manage", label: "イベント" },
  { href: "/admin", label: "管理者", adminOnly: true },
] as const;

/** デモ (/demo/…) を直接開いたときも、どの画面か分かるように */
const DEMO_PATHS: Record<string, string> = {
  "/demo/coordinator": "/coordinator",
  "/demo/schedule/plan": "/schedule/plan",
  "/demo/manage": "/manage",
  "/demo/admin": "/admin",
};

export function StaffNav({ showAdmin }: { showAdmin: boolean }) {
  const pathname = usePathname();
  const path = DEMO_PATHS[pathname] ?? pathname;
  const items = ITEMS.filter((item) => !("adminOnly" in item) || showAdmin);
  const index = items.findIndex((item) => item.href === path);
  if (index === -1) return null;

  return (
    <nav aria-label="運営の画面" className="px-4 pb-1 pt-1">
      <div className="relative mx-auto flex h-9 max-w-2xl rounded-[10px] bg-[var(--fill)] p-0.5">
        {/* 選択の印は1枚だけ置いて滑らせる (Segmented と同じ) */}
        <span
          aria-hidden
          className="absolute bottom-0.5 top-0.5 rounded-[8px] glass-thumb transition-transform duration-[420ms] ease-[var(--ease-smooth)]"
          style={{
            left: 2,
            width: `calc((100% - 4px) / ${items.length})`,
            transform: `translateX(${index * 100}%)`,
          }}
        />
        {items.map((item, i) => {
          const current = i === index;
          return (
            <Link
              key={item.href}
              href={item.href}
              prefetch
              onClick={() => rememberNavDirection(index, i)}
              aria-current={current ? "page" : undefined}
              className={`relative z-10 flex flex-1 items-center justify-center rounded-[8px] text-[13px] transition-colors ${
                current ? "font-semibold" : "font-medium text-[var(--muted)]"
              }`}
            >
              {item.label}
            </Link>
          );
        })}
      </div>
    </nav>
  );
}
