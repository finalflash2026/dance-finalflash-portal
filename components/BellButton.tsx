"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

import { BUTTON_CLASS } from "@/components/SettingsButton";

/**
 * お知らせのベル (SPEC.md §6.7.13 / v1.31)
 *
 * ホームのお知らせ欄をやめ、ここに未読の数を出す。押すと /notifications。
 * 数はレイアウトが描画のたびに数える (お知らせを読んで戻れば減っている)。
 */
export function BellButton({ unread }: { unread: number }) {
  const pathname = usePathname();
  const active = pathname === "/notifications";
  return (
    <Link
      href={active ? "/" : "/notifications"}
      aria-label={unread > 0 ? `お知らせ(未読${unread}件)` : "お知らせ"}
      className={`${BUTTON_CLASS} relative`}
      data-tour="bell"
      // iOS アプリでは本物のガラスのボタンが代わりに押す (components/NativeHeader.tsx)
      data-header-action="bell"
      data-header-badge={unread}
    >
      <svg
        width="21"
        height="21"
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.9"
        strokeLinecap="round"
        strokeLinejoin="round"
        aria-hidden
      >
        <path d="M6 8a6 6 0 0 1 12 0c0 7 3 9 3 9H3s3-2 3-9" />
        <path d="M10.3 21a1.94 1.94 0 0 0 3.4 0" />
      </svg>
      {unread > 0 ? (
        <span className="absolute -right-0.5 -top-0.5 grid h-[18px] min-w-[18px] place-items-center rounded-full bg-[var(--danger-solid)] px-1 text-[11px] font-bold text-white">
          {unread > 99 ? "99+" : unread}
        </span>
      ) : null}
    </Link>
  );
}
