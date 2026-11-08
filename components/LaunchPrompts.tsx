"use client";

import { useEffect, useState } from "react";

import { Sheet } from "@/components/Sheet";
import { TOUR_DONE_KEY } from "@/components/Tour";
import { fillButtonClass, primaryButtonClass } from "@/components/ui";
import { isNativeApp } from "@/lib/native";
import {
  canUsePush,
  hasPushSubscription,
  isIos,
  isStandalone,
  subscribePush,
} from "@/lib/push-client";

/**
 * 起動時の案内 (SPEC.md §6.7.9 / v1.30)
 *
 * - **ホーム画面への追加**: ブラウザのタブで開いている (スマホの) 人へ
 * - **通知をオンにする**: 通知を受け取れるのに、まだ登録していない現役へ
 *
 * 通知の設定は設定画面の奥にあり、**大半の人が存在に気付いていなかった**。
 * かといって毎回出すとうるさいので、起動回数を端末に数えて
 * **2回目、以降は5回に1回**だけ出す。「今後表示しない」で止められる。
 * 初回はツアー (Tour.tsx) があるので出さない。
 *
 * 起動は「タブを開いてから閉じるまで」で1回と数える (sessionStorage)。
 * 画面を移るたびに数えると、すぐに5の倍数に達してしまう。
 */

const COUNT_KEY = "launch-count";
const SESSION_KEY = "launch-counted";
const DISMISS_INSTALL_KEY = "prompt-install-off";
const DISMISS_PUSH_KEY = "prompt-push-off";

type Prompt = "install" | "push" | null;

/** この起動回で案内を出すか。2回目、以降は5回に1回 */
export function shouldPromptOnLaunch(count: number): boolean {
  return count === 2 || (count > 2 && count % 5 === 0);
}

export function LaunchPrompts({
  vapidPublicKey,
  isActiveMember,
}: {
  vapidPublicKey: string;
  /** 現役か。通知の案内は現役だけ (OB には届く通知が無い。§6.6) */
  isActiveMember: boolean;
}) {
  const [prompt, setPrompt] = useState<Prompt>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    // 見本として出す (v1.31.12)。`?prompt=install` / `?prompt=push` で回数に関係なく出る
    const forced = new URLSearchParams(window.location.search).get("prompt");
    if (forced === "install" || forced === "push") {
      const timer = window.setTimeout(() => setPrompt(forced), 600);
      return () => window.clearTimeout(timer);
    }
    let cancelled = false;
    (async () => {
      let count = 0;
      try {
        if (sessionStorage.getItem(SESSION_KEY)) return;
        sessionStorage.setItem(SESSION_KEY, "1");
        count = Number(localStorage.getItem(COUNT_KEY) ?? "0") + 1;
        localStorage.setItem(COUNT_KEY, String(count));
        // ツアーを見終わっていない (= 初めて) 人には出さない
        if (localStorage.getItem(TOUR_DONE_KEY) !== "1") return;
      } catch {
        return;
      }
      if (!shouldPromptOnLaunch(count)) return;
      // iOS アプリはもうアプリで、通知の許可もアプリが聞く (SPEC §2.3.1 / v1.38)
      if (isNativeApp()) return;

      const mobile = /iP(hone|ad|od)|Android/.test(navigator.userAgent);
      let next: Prompt = null;
      if (mobile && !isStandalone()) {
        next = localStorage.getItem(DISMISS_INSTALL_KEY) ? null : "install";
      } else if (
        isActiveMember &&
        canUsePush(vapidPublicKey) &&
        Notification.permission !== "denied" &&
        !localStorage.getItem(DISMISS_PUSH_KEY) &&
        !(await hasPushSubscription().catch(() => true))
      ) {
        next = "push";
      }
      // 起動アニメーションが終わってから出す
      if (next && !cancelled) window.setTimeout(() => setPrompt(next), 2000);
    })();
    return () => {
      cancelled = true;
    };
  }, [vapidPublicKey, isActiveMember]);

  function never() {
    try {
      localStorage.setItem(
        prompt === "install" ? DISMISS_INSTALL_KEY : DISMISS_PUSH_KEY,
        "1",
      );
    } catch {}
    setPrompt(null);
  }

  async function enablePush() {
    setBusy(true);
    setError(null);
    try {
      const permission = await subscribePush(vapidPublicKey);
      if (permission === "granted") {
        setPrompt(null);
      } else {
        setError("通知が許可されませんでした。端末の設定から許可できます。");
      }
    } catch (cause) {
      setError(
        `通知を登録できませんでした: ${cause instanceof Error ? cause.message : String(cause)}`,
      );
    } finally {
      setBusy(false);
    }
  }

  if (prompt === "install") {
    const ios = isIos();
    return (
      <Sheet
        title="ホーム画面に追加しましょう"
        onClose={() => setPrompt(null)}
        footer={
          <div className="space-y-2">
            <button type="button" onClick={() => setPrompt(null)} className={primaryButtonClass}>
              わかった
            </button>
            <button type="button" onClick={never} className={fillButtonClass}>
              今後表示しない
            </button>
          </div>
        }
      >
        <p className="text-[15px] leading-relaxed text-[var(--muted)]">
          {ios ? "iPhone は、ホーム画面に追加しないと通知が届きません。" : "練習や締切の通知も受け取れます。"}
        </p>
        <ol className="mt-4 space-y-3 text-[16px]">
          {ios ? (
            <>
              <Step n={1}>
                画面下の <ShareIcon /> (共有) を押す
              </Step>
              <Step n={2}>「ホーム画面に追加」を選ぶ</Step>
              <Step n={3}>追加されたアイコンから開く</Step>
            </>
          ) : (
            <>
              <Step n={1}>右上の ︙ (メニュー) を押す</Step>
              <Step n={2}>「ホーム画面に追加」または「アプリをインストール」を選ぶ</Step>
              <Step n={3}>追加されたアイコンから開く</Step>
            </>
          )}
        </ol>
      </Sheet>
    );
  }

  if (prompt === "push") {
    return (
      <Sheet
        title="通知をオンにしますか?"
        onClose={() => setPrompt(null)}
        footer={
          <div className="space-y-2">
            <button
              type="button"
              onClick={enablePush}
              disabled={busy}
              className={primaryButtonClass}
            >
              通知をオンにする
            </button>
            <button type="button" onClick={() => setPrompt(null)} className={fillButtonClass}>
              あとで
            </button>
            <button
              type="button"
              onClick={never}
              className="w-full py-2 text-[15px] text-[var(--muted)]"
            >
              今後表示しない
            </button>
          </div>
        }
      >
        <ul className="space-y-2 text-[16px]">
          <li>・練習がある日の朝に「今日の予定」</li>
          <li>・集金やフォームの締切</li>
          <li>・3役からの告知、練習日程の公開</li>
          <li>・練習場所や部室の鍵の連絡</li>
        </ul>
        {error ? (
          <p role="alert" className="mt-2 text-[13px] text-[var(--danger-fg)]">
            {error}
          </p>
        ) : null}
      </Sheet>
    );
  }

  return null;
}

function Step({ n, children }: { n: number; children: React.ReactNode }) {
  return (
    <li className="flex items-center gap-3">
      <span className="grid h-7 w-7 shrink-0 place-items-center rounded-full bg-[var(--tint)] text-[14px] font-bold text-white">
        {n}
      </span>
      <span>{children}</span>
    </li>
  );
}

/** iOS の共有アイコン (四角から上向きの矢印) */
function ShareIcon() {
  return (
    <svg
      viewBox="0 0 24 24"
      width="20"
      height="20"
      className="inline-block align-[-4px] text-[var(--tint)]"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-label="共有"
    >
      <path d="M12 3v12M7.5 7.5L12 3l4.5 4.5" />
      <path d="M8 10H6a2 2 0 0 0-2 2v7a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-7a2 2 0 0 0-2-2h-2" />
    </svg>
  );
}
