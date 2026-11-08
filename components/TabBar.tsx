"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useEffect, useRef } from "react";

import { isNativeApp } from "@/lib/native";
import { FFNative } from "@/lib/native-plugin";
import { rememberNavDirection } from "@/lib/nav-direction";
import type { Role } from "@/lib/types";

/**
 * 下部タブバー (SPEC.md §6.0 / §7 / §12)
 *
 * **カレンダー / ナンバー の2タブ** (v1.30 §6.7.7)。マイカレンダーと全体
 * カレンダーを1つにまとめたので、OB も現役も同じ2タブになった。
 * OB に見せないもの (鍵のボード・他ジャンル・空き) は画面の中で出し分ける。
 *
 * **左端がカレンダーで、URL も `/`**(v1.14)。毎日開くのがここなので、
 * 起動して最初に出る画面にしてある。
 *
 * 見た目は**画面から浮いた島型**(v1.14)。下の内容が透けて動くことで、
 * 画面の一部ではなく上に乗っているものだと分かる。
 *
 * 表示の出し分けは補助であり、認可の最終防衛線は RLS (SPEC §13.2)。
 */

export const TABS = [
  { href: "/", label: "カレンダー", icon: "calendar", symbol: "calendar" },
  { href: "/number-cal", label: "ナンバー", icon: "people", symbol: "person.2.fill" },
] as const;

/** 役割ごとのタブ。いまは全員同じだが、スワイプ側 (SwipeTabs) と共用するため残す */
export function visibleTabs(role: Role) {
  void role;
  return TABS;
}

/** デモの見本 (/demo/…) を直接開いたときも、どのタブの画面か分かるように */
const DEMO_TAB_PATHS: Record<string, string> = {
  "/demo/calendar": "/",
  "/demo/numbers": "/number-cal",
};

export function TabBar({ role }: { role: Role }) {
  const pathname = usePathname();
  const tabs = visibleTabs(role);
  const tabPath = DEMO_TAB_PATHS[pathname] ?? pathname;
  const currentIndex = tabs.findIndex((tab) => tab.href === tabPath);

  useNativeTabBar(tabs, currentIndex);

  // **タブの画面でだけ出す** (v1.32.7 / iOS の Tab Bars の考え方)。設定・お知らせ・
  // 折衝などの下の階層では、どのタブも選ばれていないバーが浮いて画面の下を
  // ふさいでいた (鍵と連絡の入力欄・折衝の表の横スクロールと重なる)。
  // 戻るのは左上の戻るボタン。下にはホームバーのぶんの余白だけ置く
  if (currentIndex === -1) {
    return <div aria-hidden className="h-[calc(env(safe-area-inset-bottom)+16px)]" />;
  }

  return (
    <>
      {/* 浮いたタブバーのぶん、本文の下に余白を置く (バーの高さ + 逃げ) */}
      <div aria-hidden className="h-24" />
      <TabNav tabs={tabs} currentIndex={currentIndex} />
    </>
  );
}

function TabNav({
  tabs,
  currentIndex,
}: {
  tabs: ReturnType<typeof visibleTabs>;
  currentIndex: number;
}) {
  return (
    <nav
      className="fixed inset-x-0 bottom-[calc(env(safe-area-inset-bottom)+10px)] z-40 flex justify-center px-4"
      aria-label="メインナビゲーション"
      // iOS アプリでは隠す (ネイティブのタブバーが代わる。globals.css)
      data-web-tabbar
    >
      {/*
       * 島の幅は **300px** (v1.14.2)。この値は two 段階で決まった:
       *   内容なり (約244px) … 余白のほうが目立ち、浮いて見えない
       *   画面いっぱい (約358px) … 今度は長すぎる
       * その中間に置いてある。`w-full` は画面が 300px より狭いときの保険。
       */}
      <ul
        className="glass flex w-full max-w-[260px] gap-1 rounded-full p-1"
        data-tour="tabbar"
      >
        {tabs.map((tab, index) => {
          const active = index === currentIndex;
          return (
            /* flex-1 で3タブが均等に割る (OB の2タブでも半分ずつになる) */
            <li key={tab.href} className="flex-1">
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
                className={`flex h-11 w-full items-center justify-center gap-1.5 rounded-full px-3 text-[13px] font-semibold transition-colors ${
                  active
                    ? "bg-[var(--primary)] text-[var(--primary-fg)]"
                    : "text-[var(--muted)]"
                }`}
              >
                <TabIcon name={tab.icon} />
                {tab.label}
              </Link>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}

/**
 * iOS アプリのタブバー (SPEC.md §2.3.1 / v1.38)。
 *
 * 見た目は iOS 純正のタブバー (Liquid Glass) に任せ、**何を出すか・どれを選んでいるかは
 * ここで決めて伝える**。押されたらネイティブから `tabSelect` が来るので、
 * Web のタブを押したときと同じように移る。
 */
function useNativeTabBar(tabs: ReturnType<typeof visibleTabs>, currentIndex: number) {
  const router = useRouter();
  const indexRef = useRef(currentIndex);
  indexRef.current = currentIndex;

  // 出し入れ・選択・明暗を伝える。テーマが変わったら伝え直す。
  // ネイティブのバーは Web のどの層よりも上に乗るので、**窓 (role=dialog) が
  // 開いている間はしまう**。しまわないと窓の下の端 (ボタン) を隠してしまう
  useEffect(() => {
    if (!isNativeApp()) return;
    let lastKey = "";
    let frame = 0;
    const send = () => {
      // 起動アニメーションの幕の上にも出さない (幕が消えたら data-splash が立つ)
      const splash = document.documentElement.dataset.splash;
      const dialogOpen =
        document.querySelector('[role="dialog"][aria-modal="true"]') !== null ||
        !(splash === "off" || splash === "done");
      const theme = document.documentElement.dataset.theme ?? "light";
      const key = `${currentIndex}|${dialogOpen}|${theme}`;
      if (key === lastKey) return;
      lastKey = key;
      const style = getComputedStyle(document.documentElement);
      void FFNative.setTabBar({
        visible: currentIndex !== -1 && !dialogOpen,
        selected: currentIndex === -1 ? undefined : tabs[currentIndex].href,
        tabs: tabs.map((tab) => ({ id: tab.href, label: tab.label, symbol: tab.symbol })),
        // 選んでいるタブの色。iOS のタブバーと同じく --tint (青)
        tint: style.getPropertyValue("--tint").trim(),
        dark: document.documentElement.dataset.theme === "dark",
      }).catch(() => {});
    };
    send();
    const schedule = () => {
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(send);
    };
    const themeObserver = new MutationObserver(schedule);
    themeObserver.observe(document.documentElement, {
      attributeFilter: ["data-theme", "data-splash"],
    });
    const dialogObserver = new MutationObserver(schedule);
    dialogObserver.observe(document.body, {
      childList: true,
      subtree: true,
      attributeFilter: ["role", "aria-modal"],
    });
    return () => {
      cancelAnimationFrame(frame);
      themeObserver.disconnect();
      dialogObserver.disconnect();
    };
  }, [tabs, currentIndex]);

  // 画面を離れたら (ログアウトなど) しまう
  useEffect(() => {
    if (!isNativeApp()) return;
    return () => {
      void FFNative.setTabBar({ visible: false }).catch(() => {});
    };
  }, []);

  useEffect(() => {
    if (!isNativeApp()) return;
    // Web のタブの Link と同じく先に読んでおく (隠した Link は先読みされない)
    tabs.forEach((tab) => router.prefetch(tab.href));
    let handle: { remove: () => Promise<void> } | undefined;
    let cancelled = false;
    void FFNative.addListener("tabSelect", ({ id }) => {
      const index = tabs.findIndex((tab) => tab.href === id);
      if (index === -1 || index === indexRef.current) return;
      rememberNavDirection(indexRef.current, index);
      router.push(id);
    }).then((h) => {
      if (cancelled) void h.remove();
      else handle = h;
    });
    return () => {
      cancelled = true;
      void handle?.remove();
    };
  }, [tabs, router]);
}

/** タブのアイコン (SF Symbols の calendar / person.2 に近い形を線で描く) */
function TabIcon({ name }: { name: (typeof TABS)[number]["icon"] }) {
  const common = {
    width: 18,
    height: 18,
    viewBox: "0 0 24 24",
    fill: "none",
    stroke: "currentColor",
    strokeWidth: 2,
    strokeLinecap: "round" as const,
    strokeLinejoin: "round" as const,
    "aria-hidden": true,
  };
  if (name === "calendar") {
    return (
      <svg {...common}>
        <rect x="3" y="4.5" width="18" height="16.5" rx="3" />
        <path d="M3 9.5h18M8 2.5v4M16 2.5v4" />
      </svg>
    );
  }
  return (
    <svg {...common}>
      <circle cx="9" cy="8" r="3.5" />
      <path d="M2.5 20c.6-3.6 3.3-5.5 6.5-5.5s5.9 1.9 6.5 5.5" />
      <circle cx="17" cy="9" r="2.6" />
      <path d="M17.5 14.6c2.3.3 3.7 2 4 4.4" />
    </svg>
  );
}
