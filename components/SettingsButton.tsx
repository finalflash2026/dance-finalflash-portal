"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useEffect, useRef } from "react";

/**
 * ヘッダの設定ボタン (SPEC.md §12)
 *
 * **開くだけでなく閉じられる** (v1.14.2)。設定を開いたあと同じ場所をもう一度
 * 押すと、直前に見ていた画面へ戻る。今までは下のタブを押すしかなく、
 * 「全体カレンダーを見ていたのに、閉じたらマイカレンダーにいた」が起きていた。
 *
 * **直前の画面はこのコンポーネントが覚える。** 置き場所は `(app)/layout.tsx` で、
 * レイアウトはタブ間の移動でも設定への移動でも作り直されないため、
 * ref がそのまま残る。
 *
 * 覚えが無いとき (URL直打ち・通知から直接開いた・再読み込み) は `router.back()`
 * を使わない。**サイトの外へ出てしまう**ので、マイカレンダーへ送る。
 */

const SETTINGS_PATH = "/settings";

/** 浮いた丸ボタン。タブバーと同じすりガラス */
const BUTTON_CLASS =
  "glass flex h-10 w-10 shrink-0 items-center justify-center rounded-full";

export function SettingsButton() {
  const pathname = usePathname();
  const router = useRouter();
  const cameFrom = useRef<string | null>(null);

  useEffect(() => {
    if (pathname !== SETTINGS_PATH) cameFrom.current = pathname;
  }, [pathname]);

  if (pathname !== SETTINGS_PATH) {
    return (
      <Link href={SETTINGS_PATH} aria-label="設定" className={BUTTON_CLASS}>
        <MenuIcon />
      </Link>
    );
  }

  return (
    <button
      type="button"
      aria-label="設定を閉じる"
      onClick={() => {
        if (cameFrom.current) {
          // 戻るを使う。push だと履歴が伸び続け、端末の戻るで設定を
          // 何度も通ることになる
          router.back();
        } else {
          router.push("/");
        }
      }}
      className={BUTTON_CLASS}
    >
      <CloseIcon />
    </button>
  );
}

/**
 * 設定の入口 (SPEC §12 / v1.14)
 *
 * 上から順に短くなる3本線。文字の「設定」から替えたのは、
 * 画面の幅を文字に取られていたのと、浮いた丸ボタンに文字が収まらないため。
 * 意味は `aria-label` が持つので、読み上げでは今までどおり「設定」と読まれる。
 */
function MenuIcon() {
  return (
    <svg
      width="18"
      height="14"
      viewBox="0 0 18 14"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      aria-hidden
    >
      <line x1="1" y1="1" x2="17" y2="1" />
      <line x1="1" y1="7" x2="12" y2="7" />
      <line x1="1" y1="13" x2="7" y2="13" />
    </svg>
  );
}

/**
 * 設定を閉じる。**三本線のままにしない。**
 * 同じ絵で挙動だけ変わると、押した人には何が起きるか分からない。
 */
function CloseIcon() {
  return (
    <svg
      width="14"
      height="14"
      viewBox="0 0 14 14"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      aria-hidden
    >
      <line x1="1" y1="1" x2="13" y2="13" />
      <line x1="13" y1="1" x2="1" y2="13" />
    </svg>
  );
}
