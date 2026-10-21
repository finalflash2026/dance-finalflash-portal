"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";

import { closeSettings } from "@/components/SettingsButton";

/**
 * ヘッダー左上の戻るボタン (SPEC §6.7.13 / v1.31.8 → v1.31.9)。
 *
 * **どの画面でも同じ場所 (ヘッダーの左上) に出す** (v1.31.9)。画面ごとに
 * 本文の頭へ置いていたときは、画面によって高さがずれて探す手間があった。
 * 高さ 44px (iOS の押しやすい大きさ)・文字 16px。矢印と文字の組をボタンの
 * 真ん中に置く (左右の余白をそろえる)。
 *
 * どこへ戻るかは画面で決まる。タブの画面 (ホーム・ナンバー) では出さない。
 */
function backTarget(pathname: string): { href: string; label: string } | null {
  const path = pathname.replace(/^\/demo(?=\/)/, "");
  if (path === "/settings") return { href: "/", label: "戻る" };
  if (path === "/keys" || path === "/notifications") return { href: "/", label: "戻る" };
  if (path.startsWith("/numbers/") || path === "/number") {
    return { href: "/number-cal", label: "ナンバー" };
  }
  if (
    path === "/manage" ||
    path === "/schedule" ||
    path.startsWith("/admin") ||
    path.startsWith("/coordinator")
  ) {
    return { href: "/settings", label: "設定" };
  }
  return null;
}

const CLASS_NAME =
  "inline-flex h-11 items-center justify-center gap-1 rounded-full bg-[var(--fill)] px-3.5 text-[16px] font-semibold leading-none text-[var(--tint)] active:opacity-60";

export function BackButton() {
  const pathname = usePathname();
  const router = useRouter();
  const target = backTarget(pathname);
  if (!target) return null;

  const content = (
    <>
      <svg viewBox="0 0 10 18" width="9" height="16" aria-hidden className="shrink-0">
        <path
          d="M8.5 1.5L1.5 9l7 7.5"
          fill="none"
          stroke="currentColor"
          strokeWidth="2.4"
          strokeLinecap="round"
          strokeLinejoin="round"
        />
      </svg>
      {/* 矢印のぶん左が重く見えるので、文字を少しだけ右に寄せない (余白は左右同じ) */}
      <span>{target.label}</span>
    </>
  );

  // 設定はどこからでも開けるので、右上の ✕ と同じく入る前の画面へ戻る
  if (pathname === "/settings" || pathname === "/demo/settings") {
    return (
      <button type="button" onClick={() => closeSettings(router)} className={CLASS_NAME}>
        {content}
      </button>
    );
  }
  return (
    <Link href={target.href} prefetch className={CLASS_NAME}>
      {content}
    </Link>
  );
}
