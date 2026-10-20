"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useState } from "react";

import { BUTTON_CLASS } from "@/components/SettingsButton";
import { Sheet } from "@/components/Sheet";
import { GroupHeader, fillButtonClass, groupClass } from "@/components/ui";
import { START_TOUR_EVENT, hasTour } from "@/components/Tour";

/**
 * ? ボタンとヒント (SPEC.md §6.7.9 / v1.30)
 *
 * **利用者が必ず知りたいのに、見つけにくいこと**だけを並べる。
 * 機能の説明書ではなく「どうすればいいの?」に答える一覧にする。
 * 通知の設定に何か月も気付かれていなかった、という反省が出発点。
 *
 * 一番下から初回ツアー (components/Tour.tsx) を見返せる。
 */

/**
 * v1.31.9 で作り直した。以前は文章で説明していて、どこを押せばよいかが
 * 文の中に埋もれていた。**やりたいことを見出しに、押す場所を番号付きの手順に**し、
 * ボタンの名前は今の画面に出ている文字と同じにする。
 */
interface Hint {
  q: string;
  /** 押す順番。1つずつ短く */
  steps: React.ReactNode[];
  /** 手順のあとに添える一言 (無くてよい) */
  note?: React.ReactNode;
}

const GROUPS: { title: string; hints: Hint[] }[] = [
  {
    title: "はじめに (最初に1回だけ)",
    hints: [
      {
        q: "ホーム画面に追加する",
        steps: [
          <>iPhone: 画面下の<b>共有ボタン</b>(四角から矢印)を押す</>,
          <><b>ホーム画面に追加</b> → <b>追加</b></>,
        ],
        note: "Android は右上の︙ →「ホーム画面に追加」。アプリのように開けて、通知も届くようになります。",
      },
      {
        q: "通知を受け取る",
        steps: [
          <>ホーム画面に追加した<b>アイコンから</b>開く</>,
          <>右上の<b>歯車</b> → <b>通知</b></>,
          <><b>この端末で通知を受け取る</b>を押す</>,
        ],
        note: "練習のある日の朝・締切・告知などが届きます。種類ごとにオン/オフできます。",
      },
      {
        q: "予定をスマホのカレンダーに入れる",
        steps: [
          <>右上の<b>歯車</b> → <b>カレンダーに追加</b></>,
          <><b>iPhone / Mac</b> か <b>Google</b> のボタンを押す</>,
        ],
        note: "一度入れれば、あとは自動で入り続けます。",
      },
    ],
  },
  {
    title: "練習の日",
    hints: [
      {
        q: "欠席・遅刻を伝える",
        steps: [
          <>カレンダーの下の一覧で<b>自分の予定</b>を押す(「時間」の表示でも押せます)</>,
          <><b>欠席・遅刻・早退</b>を選ぶ</>,
        ],
        note: "出席するときは何もしなくて大丈夫です。",
      },
      {
        q: "空いている部屋で自主練する",
        steps: [
          <>ホームの<b>今日自主練できる部屋</b>で部屋を押す</>,
          <>時間を選んで<b>確認へ進む</b> → <b>はい</b></>,
        ],
        note: "別の日は、カレンダーの右の「表示」→「空き」をオンにすると出ます。",
      },
      {
        q: "練習場所の鍵を開けた・閉めた",
        steps: [
          <>ホームの<b>練習場所の鍵・部室の鍵・連絡</b>を押す</>,
          <>部屋を押して、<b>開けましたと報告する</b>(閉めたときは「閉めましたと報告する」)</>,
        ],
        note: "開けたときは現役全員に通知が届きます。",
      },
    ],
  },
  {
    title: "画面の見方",
    hints: [
      {
        q: "日付を変える",
        steps: [
          <>週の帯の日付を押す。<b>横に滑らせる</b>と前後の週へ</>,
          <>カレンダーの上の<b>日付のボタン</b>を押すと月の表示に広がる(もう一度押すと週に戻る)</>,
          <>月の表示は<b>左右に滑らせる</b>と前後の月へ</>,
          <><b>今日</b>のボタンで今日に戻る</>,
        ],
      },
      {
        q: "一覧・時間・部屋の違い",
        steps: [
          <><b>一覧</b>: その日の予定を時刻順に</>,
          <><b>時間</b>: 1日の時間の流れで。練習の無い時間は畳まれる(押すと開く)</>,
          <><b>部屋</b>: 部屋ごとに、どこが使われているか</>,
        ],
      },
      {
        q: "他のジャンルの練習や空きも見たい",
        steps: [
          <>カレンダーの右の<b>表示</b>を押す</>,
          <>見たいジャンルや<b>空き</b>をオンにする</>,
        ],
        note: "足したものは薄い色で出ます。「自分の予定だけ」で元に戻せます。足しているときはボタンに数が出ます。",
      },
      {
        q: "ホームの並びを変える",
        steps: [
          <>右上の<b>歯車</b> → <b>ホームの並び</b></>,
          <>↑↓ で並べ替え、スイッチで出す/出さないを選ぶ</>,
        ],
      },
      {
        q: "締切やイベントはどこに出る?",
        steps: [
          <>2週間以内の締切はホームの<b>近い締切</b>に</>,
          <>合宿などのイベントはカレンダーに金色で</>,
        ],
        note: "締切の日の朝に通知が届き、集金など大事な締切は1週間前にも届きます。",
      },
    ],
  },
];

export function HelpButton() {
  const [open, setOpen] = useState(false);
  const pathname = usePathname();
  const router = useRouter();

  // この画面にツアーがあればそれを、無ければホームのツアーを見せる (v1.31.11)
  const pageTour = hasTour(pathname);
  function startTour() {
    setOpen(false);
    if (!pageTour) {
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
        <span aria-hidden className="text-[20px] font-bold leading-none">
          ?
        </span>
      </button>

      {open ? (
        <Sheet title="使い方とヒント" onClose={() => setOpen(false)}>
          <div className="space-y-5">
            {/* ツアーは一番上に (v1.31.11)。手順を読むより、画面で見せたほうが早い */}
            <button type="button" onClick={startTour} className={`${fillButtonClass} gap-2`}>
              <svg viewBox="0 0 24 24" width="18" height="18" fill="currentColor" aria-hidden>
                <path d="M8 5v14l11-7z" />
              </svg>
              {pageTour ? "この画面の使い方ツアーを見る" : "使い方ツアーを見る (ホーム)"}
            </button>
            {GROUPS.map((group) => (
              <div key={group.title}>
                <GroupHeader>{group.title}</GroupHeader>
                <ul className={groupClass}>
                  {group.hints.map((hint) => (
                    <li key={hint.q}>
                      <details className="group">
                        <summary className="flex min-h-[48px] cursor-pointer list-none items-center justify-between gap-3 px-4 py-3 text-[17px] [&::-webkit-details-marker]:hidden">
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
                        <div className="space-y-2 px-4 pb-4">
                          <ol className="space-y-2">
                            {hint.steps.map((step, i) => (
                              <li key={i} className="flex gap-2.5 text-[16px] leading-snug">
                                <span
                                  aria-hidden
                                  className="grid h-6 w-6 shrink-0 place-items-center rounded-full bg-[var(--tint)] text-[13px] font-bold text-white"
                                >
                                  {i + 1}
                                </span>
                                <span className="pt-0.5 [&_b]:font-semibold [&_b]:text-[var(--tint)]">
                                  {step}
                                </span>
                              </li>
                            ))}
                          </ol>
                          {hint.note ? (
                            <p className="text-[15px] leading-relaxed text-[var(--muted)]">
                              {hint.note}
                            </p>
                          ) : null}
                        </div>
                      </details>
                    </li>
                  ))}
                </ul>
              </div>
            ))}
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
