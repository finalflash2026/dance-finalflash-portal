"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useEffect } from "react";

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
  "/schedule",
  // お知らせ・鍵と連絡 (v1.31) は入れない (v1.32.7)。そこから設定を開いて
  // 閉じたら、お知らせ・鍵と連絡へ戻る
];

function isAboveTabs(pathname: string): boolean {
  return ABOVE_TABS.some(
    (path) => pathname === path || pathname.startsWith(`${path}/`),
  );
}

/**
 * 浮いた丸ボタン。タブバーと同じすりガラス。
 * 44px (v1.31.9。40px では押し損ねが多かった。iOS の押しやすい大きさ)。
 * 押した瞬間に縮めて、反応したことを見せる
 */
export const BUTTON_CLASS =
  "glass flex h-11 w-11 shrink-0 items-center justify-center rounded-full transition-transform active:scale-90";

/**
 * 設定に入る前の画面。ヘッダー左上の戻るボタン (BackButton) と右上の ✕ が
 * 同じ行き先を使うので、モジュールに1つだけ持つ (レイアウトは作り直されない)
 */
const settingsReturn: { cameFrom: string | null; oneStepBack: boolean } = {
  cameFrom: null,
  oneStepBack: false,
};

/** 設定を閉じて、入る前の画面へ戻る */
export function closeSettings(router: ReturnType<typeof useRouter>) {
  if (!settingsReturn.cameFrom) {
    router.push("/");
  } else if (settingsReturn.oneStepBack) {
    // 素直に開いただけなら戻るで済ませる。push だと履歴が伸び続け、
    // 端末の戻るで設定を何度も通ることになる
    router.back();
  } else {
    // 設定の上に管理者・折衝を積んでいる。何回戻ればよいかは
    // 数えられない (端末の戻るでも動く) ので、行き先を直接指定する
    router.push(settingsReturn.cameFrom);
  }
}

export function SettingsButton() {
  const pathname = usePathname();
  useEffect(() => {
    if (!isAboveTabs(pathname)) {
      // タブ側の画面。`?date=` まで含めて覚え、戻ったときに同じ日を出す
      settingsReturn.cameFrom = `${pathname}${window.location.search}`;
      settingsReturn.oneStepBack = true;
    } else if (pathname !== SETTINGS_PATH) {
      // 管理者・折衝へ入った。ここから設定に戻っても、履歴は伸びたまま
      settingsReturn.oneStepBack = false;
    }
  }, [pathname]);

  if (pathname !== SETTINGS_PATH) {
    return (
      <Link
        href={SETTINGS_PATH}
        // 押してから開くまでが遅かった (v1.31.9)。先に読み込んでおく
        prefetch
        aria-label="設定"
        className={BUTTON_CLASS}
        data-tour="settings"
      >
        <GearIcon />
      </Link>
    );
  }

  // 設定の中では出さない (v1.31.11)。閉じるのは左上の戻るボタン (BackButton) だけにする。
  // 右上に ✕ もあると、同じことをするボタンが2つになる
  return null;
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
      width="22"
      height="22"
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

