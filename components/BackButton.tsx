"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";

/**
 * 画面左上の「‹ ホーム」などの戻るボタン (SPEC §6.7.13 / v1.31.8)。
 *
 * 小さな文字のリンクでは見つけにくく押しにくかったので、高さ 44px
 * (iOS の押しやすい大きさ)・文字 16px の丸いボタンにする。
 *
 * `history` を付けると、来た画面へ戻る (設定のように、どこからでも開ける画面)。
 * 履歴が無い (直接開いた・ホーム画面のアイコンから開いた) ときは href へ行く。
 */
export function BackButton({
  href,
  label,
  history = false,
}: {
  href: string;
  label: string;
  history?: boolean;
}) {
  const router = useRouter();
  const className =
    "inline-flex h-11 items-center gap-1 rounded-full bg-[var(--fill)] pl-2.5 pr-4 text-[16px] font-semibold text-[var(--tint)] active:opacity-60";
  const content = (
    <>
      <svg
        viewBox="0 0 10 18"
        width="9"
        height="16"
        aria-hidden
        className="shrink-0"
      >
        <path
          d="M8.5 1.5L1.5 9l7 7.5"
          fill="none"
          stroke="currentColor"
          strokeWidth="2.4"
          strokeLinecap="round"
          strokeLinejoin="round"
        />
      </svg>
      {label}
    </>
  );

  if (history) {
    return (
      <button
        type="button"
        onClick={() => {
          if (window.history.length > 1) router.back();
          else router.push(href);
        }}
        className={className}
      >
        {content}
      </button>
    );
  }
  return (
    <Link href={href} className={className}>
      {content}
    </Link>
  );
}
