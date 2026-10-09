"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useState } from "react";

import { BUTTON_CLASS } from "@/components/SettingsButton";
import { Sheet } from "@/components/Sheet";
import { fillButtonClass, groupClass } from "@/components/ui";
import { START_TOUR_EVENT } from "@/components/Tour";

/**
 * ? ボタンとヒント (SPEC.md §6.7.9 / v1.30)
 *
 * **利用者が必ず知りたいのに、見つけにくいこと**だけを並べる。
 * 機能の説明書ではなく「どうすればいいの?」に答える一覧にする。
 * 通知の設定に何か月も気付かれていなかった、という反省が出発点。
 *
 * 一番下から初回ツアー (components/Tour.tsx) を見返せる。
 */

interface Hint {
  q: string;
  a: React.ReactNode;
}

const HINTS: Hint[] = [
  {
    q: "通知を受け取るには?",
    a: (
      <>
        iPhone は<strong>ホーム画面に追加したアイコンから開いたときだけ</strong>
        通知を受け取れます。追加したら、右上の歯車 →「通知」で
        「この端末で通知を受け取る」を押してください。練習・締切・告知など、
        種類ごとにオン/オフできます。
      </>
    ),
  },
  {
    q: "ホーム画面に追加するには?",
    a: (
      <>
        <strong>iPhone (Safari)</strong>: 下の共有ボタン (四角から矢印) →
        「ホーム画面に追加」。
        <br />
        <strong>Android (Chrome)</strong>: 右上の︙ →「ホーム画面に追加」または
        「アプリをインストール」。
      </>
    ),
  },
  {
    q: "自分のカレンダーアプリに予定を入れたい",
    a: (
      <>
        歯車 →「カレンダーに追加」のボタンから登録できます。iPhone
        の標準カレンダーはボタン1つ。Google カレンダーはブラウザで開いて登録します
        (アプリからは追加できません)。一度登録すれば、予定は自動で入り続けます。
      </>
    ),
  },
  {
    q: "空いている部屋を使いたい",
    a: (
      <>
        カレンダーで日付を選び、薄く出ている「空き」を押すと申請できます。
        今すぐ使いたいときは、上の「いま空いている部屋」から。
      </>
    ),
  },
  {
    q: "欠席・遅刻を伝えたい",
    a: (
      <>
        カレンダーで自分の予定を押すと、欠席・遅刻・早退を登録できます。
        <strong>出席するときは何もしなくて大丈夫</strong>です。
      </>
    ),
  },
  {
    q: "練習場所の鍵を開けた・閉めた",
    a: (
      <>
        カレンダー上の「今日の練習場所」で部屋を押し、
        「開けましたと報告する」を押します。現役全員に通知が届きます。
      </>
    ),
  },
  {
    q: "締切やイベントはどこで分かる?",
    a: (
      <>
        近い締切はカレンダーの上にまとめて出ます。締切の日の朝に通知が届き、
        集金などの大事な締切は1週間前の朝にも届きます。合宿などのイベントは
        カレンダーに金色で出ます。
      </>
    ),
  },
];

export function HelpButton() {
  const [open, setOpen] = useState(false);
  const pathname = usePathname();
  const router = useRouter();

  function startTour() {
    setOpen(false);
    // ツアーはカレンダーの部品を指すので、別の画面にいるなら戻ってから始める
    if (pathname !== "/") {
      router.push("/?tour=1");
      return;
    }
    window.dispatchEvent(new Event(START_TOUR_EVENT));
  }

  return (
    <>
      <button
        type="button"
        aria-label="使い方とヒント"
        onClick={() => setOpen(true)}
        className={BUTTON_CLASS}
        data-tour="help"
      >
        <span aria-hidden className="text-[18px] font-bold leading-none">
          ?
        </span>
      </button>

      {open ? (
        <Sheet title="使い方とヒント" onClose={() => setOpen(false)}>
          <div className="space-y-4">
            <ul className={groupClass}>
              {HINTS.map((hint) => (
                <li key={hint.q}>
                  <details className="group">
                    <summary className="flex cursor-pointer list-none items-center justify-between gap-3 px-4 py-3 text-[17px] [&::-webkit-details-marker]:hidden">
                      {hint.q}
                      <svg
                        aria-hidden
                        viewBox="0 0 14 8"
                        width="12"
                        height="8"
                        className="shrink-0 text-[var(--muted)] transition-transform group-open:rotate-180"
                      >
                        <path
                          d="M1 1l6 6 6-6"
                          fill="none"
                          stroke="currentColor"
                          strokeWidth="2"
                          strokeLinecap="round"
                        />
                      </svg>
                    </summary>
                    <p className="px-4 pb-3 text-[15px] leading-relaxed text-[var(--muted)]">
                      {hint.a}
                    </p>
                  </details>
                </li>
              ))}
            </ul>
            <button type="button" onClick={startTour} className={fillButtonClass}>
              使い方ツアーをもう一度見る
            </button>
            <Link
              href="/settings"
              onClick={() => setOpen(false)}
              className="block text-center text-[15px] text-[var(--tint)]"
            >
              設定を開く
            </Link>
          </div>
        </Sheet>
      ) : null}
    </>
  );
}
