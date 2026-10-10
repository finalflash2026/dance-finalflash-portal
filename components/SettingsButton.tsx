"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useEffect, useRef } from "react";

/**
 * ヘッダの設定ボタン (SPEC.md §12)
 *
 * **開くだけでなく閉じられる** (v1.14.2)。設定を開いたあと同じ場所をもう一度
 * 押すと、設定に入る前の画面へ戻る。今までは下のタブを押すしかなく、
 * 「全体カレンダーを見ていたのに、閉じたらマイカレンダーにいた」が起きていた。
 *
 * **戻る先は「1つ前」ではなく「設定に入る前」** (v1.27.1)。画面は
 * タブ → 設定 → 管理者/折衝 の順に積み上がるので、1つ前へ戻すと
 * 設定 → 管理者 → 設定 と辿ったときに**閉じたはずが管理者画面に出る**。
 * 設定より上に積んだものはまとめて畳んで、タブの画面へ戻す。
 *
 * **入る前の画面はこのコンポーネントが覚える。** 置き場所は `(app)/layout.tsx` で、
 * レイアウトはタブ間の移動でも設定への移動でも作り直されないため、
 * ref がそのまま残る。
 *
 * 覚えが無いとき (URL直打ち・通知から直接開いた・再読み込み) は `router.back()`
 * を使わない。**サイトの外へ出てしまう**ので、マイカレンダーへ送る。
 */

const SETTINGS_PATH = "/settings";

/**
 * 設定と、その上に積まれる画面。**閉じる先の候補にしない。**
 * 管理者画面と折衝画面は設定の中からしか入口が無く、
 * 「設定を閉じた先」として妥当なのはタブ側の画面だけ。
 */
const ABOVE_TABS = [
  SETTINGS_PATH,
  "/admin",
  "/coordinator",
  "/manage",
  // v1.31 (§6.7.13)。ホームから入る画面。閉じたらホームへ戻る
  "/keys",
  "/notifications",
];

function isAboveTabs(pathname: string): boolean {
  return ABOVE_TABS.some(
    (path) => pathname === path || pathname.startsWith(`${path}/`),
  );
}

/** 浮いた丸ボタン。タブバーと同じすりガラス */
export const BUTTON_CLASS =
  "glass flex h-10 w-10 shrink-0 items-center justify-center rounded-full";

export function SettingsButton() {
  const pathname = usePathname();
  const router = useRouter();
  /** 設定に入る前に見ていた画面。日付などの指定ごと覚える */
  const cameFrom = useRef<string | null>(null);
  /** 設定の上に何も積んでいない (= 戻るが1回で足りる) か */
  const oneStepBack = useRef(false);

  useEffect(() => {
    if (!isAboveTabs(pathname)) {
      // タブ側の画面。`?date=` まで含めて覚え、戻ったときに同じ日を出す
      cameFrom.current = `${pathname}${window.location.search}`;
      oneStepBack.current = true;
    } else if (pathname !== SETTINGS_PATH) {
      // 管理者・折衝へ入った。ここから設定に戻っても、履歴は伸びたまま
      oneStepBack.current = false;
    }
  }, [pathname]);

  if (pathname !== SETTINGS_PATH) {
    return (
      <Link
        href={SETTINGS_PATH}
        aria-label="設定"
        className={BUTTON_CLASS}
        data-tour="settings"
      >
        <GearIcon />
      </Link>
    );
  }

  return (
    <button
      type="button"
      aria-label="設定を閉じる"
      onClick={() => {
        if (!cameFrom.current) {
          router.push("/");
        } else if (oneStepBack.current) {
          // 素直に開いただけなら戻るで済ませる。push だと履歴が伸び続け、
          // 端末の戻るで設定を何度も通ることになる
          router.back();
        } else {
          // 設定の上に管理者・折衝を積んでいる。何回戻ればよいかは
          // 数えられない (端末の戻るでも動く) ので、行き先を直接指定する
          router.push(cameFrom.current);
        }
      }}
      className={BUTTON_CLASS}
    >
      <CloseIcon />
    </button>
  );
}

/**
 * 設定の入口。**歯車** (v1.30 §6.7.8)。
 *
 * v1.14 では短くなる3本線を使っていたが、3本線は「メニュー」に読まれ、
 * 設定がそこにあると気付かれにくかった。iOS の「設定」と同じ歯車にする。
 * 意味は `aria-label` が持つので、読み上げでは今までどおり「設定」と読まれる。
 */
function GearIcon() {
  return (
    <svg
      width="20"
      height="20"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.9"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden
    >
      <path d="M12.22 2h-.44a2 2 0 0 0-2 2v.18a2 2 0 0 1-1 1.73l-.43.25a2 2 0 0 1-2 0l-.15-.08a2 2 0 0 0-2.73.73l-.22.38a2 2 0 0 0 .73 2.73l.15.1a2 2 0 0 1 1 1.72v.51a2 2 0 0 1-1 1.74l-.15.09a2 2 0 0 0-.73 2.73l.22.38a2 2 0 0 0 2.73.73l.15-.08a2 2 0 0 1 2 0l.43.25a2 2 0 0 1 1 1.73V20a2 2 0 0 0 2 2h.44a2 2 0 0 0 2-2v-.18a2 2 0 0 1 1-1.73l.43-.25a2 2 0 0 1 2 0l.15.08a2 2 0 0 0 2.73-.73l.22-.39a2 2 0 0 0-.73-2.73l-.15-.08a2 2 0 0 1-1-1.74v-.5a2 2 0 0 1 1-1.74l.15-.09a2 2 0 0 0 .73-2.73l-.22-.38a2 2 0 0 0-2.73-.73l-.15.08a2 2 0 0 1-2 0l-.43-.25a2 2 0 0 1-1-1.73V4a2 2 0 0 0-2-2z" />
      <circle cx="12" cy="12" r="3" />
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
