"use client";

import { useState } from "react";

import { DayGrid, type DayBlock } from "@/components/DayGrid";
import { MiniCalendar } from "@/components/MiniCalendar";
import { formatDateLabel } from "@/lib/time";
import type { DateString } from "@/lib/types";

/**
 * タブ① の「ミニカレンダー → 日別ビュー」導線 (SPEC.md §6.0 / §6.1)
 *
 * **なぜクライアント側で日付を持つのか**
 * サーバーは選択日ではなく「その月ぶん」の slots をまとめて取得している
 * (SPEC §13.1: 月単位で1クエリ)。つまり同じ月の中で日付を変えても、
 * 新しく取りに行くデータは無い。それなのに `?date=` を変えるナビゲーションを
 * 起こすと、middleware の認証と slots の再取得でサーバー往復が発生し、
 * 本番実測で 1タップあたり約270ms かかっていた。
 *
 * ここで state として持つことで日付切り替えは往復ゼロになる。
 * URL は history.replaceState で同期するだけなので、共有・リロード・
 * 戻る操作の挙動は従来どおり保たれる (ナビゲーションは発生しない)。
 *
 * 月送りは新しい月のデータが要るため、実際の遷移のまま
 * (MiniCalendar 側で prefetch を明示して先読みさせている)。
 */
export function CalendarView({
  monthAnchor,
  initialDate,
  today,
  markedDates,
  blocksByDate,
  currentUserId,
  canManage,
}: {
  /** 表示中の月 */
  monthAnchor: DateString;
  /** サーバーが決めた初期選択日 (?date= または JST の今日) */
  initialDate: DateString;
  /** JST の今日 */
  today: DateString;
  /** ドットを出す日 */
  markedDates: DateString[];
  /** その月の slot を日付ごとにまとめたもの */
  blocksByDate: Record<DateString, DayBlock[]>;
  /** 申請の取消ボタンを出すかの判定に使う */
  currentUserId: string;
  /** 折衝以上か。他人の申請も取消せる (SPEC §6.1-5) */
  canManage: boolean;
}) {
  const [selectedDate, setSelectedDate] = useState(initialDate);

  function selectDate(date: DateString) {
    setSelectedDate(date);
    // ナビゲーションを起こさずに URL だけ合わせる。
    // これでリロードや共有をしても同じ日が開く。
    //
    // **今日を選んだときは ?date= を消す。** 残したままだと、その URL で
    // 次にアプリを開いたときに「今日」ではなく当時の日付が出てしまう。
    // 既定の入口は常に今日であってほしい (SPEC §6.0「初期値=当日選択」)。
    window.history.replaceState(
      null,
      "",
      date === today ? window.location.pathname : `?date=${encodeURIComponent(date)}`,
    );
  }

  return (
    <>
      <MiniCalendar
        basePath="/overview"
        monthAnchor={monthAnchor}
        selectedDate={selectedDate}
        today={today}
        markedDates={markedDates}
        onSelectDate={selectDate}
      />

      <section className="space-y-1">
        <h2 className="text-sm font-bold">
          {formatDateLabel(selectedDate)} の練習
          {selectedDate === today ? (
            <span className="ml-1 font-normal text-[var(--muted)]">(今日)</span>
          ) : null}
        </h2>
        <DayGrid
          date={selectedDate}
          blocks={blocksByDate[selectedDate] ?? []}
          currentUserId={currentUserId}
          canManage={canManage}
        />
      </section>
    </>
  );
}
