"use client";

import { NumberList, type NumberSummary } from "@/components/NumberList";
import {
  StudioPracticeSection,
  type StudioPractice,
} from "@/components/StudioPracticeSection";

/**
 * タブ② ナンバー (SPEC.md §6.0 / §6.3 / §6.3.1)
 *
 * 上から **所属ナンバー → ナンバーをつくる → スタ練を設定する**。
 *
 * **カレンダーは置かない** (v1.23 で外した)。予定を見る場所はマイカレンダーに
 * 一本化してある — ナンバー練もスタ練も公式練も、その人にとっては
 * 同じ「自分の予定」で、タブごとに別のカレンダーを見に行く理由が無い。
 * このタブは**予定を作る側**の画面という位置づけにした。
 */
export function NumberCalendarClient({
  currentUserId,
  numbers,
  numbersError,
  mainGenreCode,
  mainGenreId,
  practices,
  generations,
}: {
  currentUserId: string;
  numbers: NumberSummary[];
  numbersError: string | null;
  /** OB は 1ジャンのスタ練を持たないので null (§3.6) */
  mainGenreCode: string | null;
  mainGenreId: number | null;
  practices: StudioPractice[];
  /** 対象期の候補 (現役に実在する期。新しい順) */
  generations: number[];
}) {
  return (
    <>
      <NumberList
        numbers={numbers}
        currentUserId={currentUserId}
        loadError={numbersError}
      />

      {/*
        スタ練は現役だけ (§6.3.1)。OB は公式練を見られないので、
        ジャンル単位の練習にも関わらない
      */}
      {mainGenreCode && mainGenreId !== null ? (
        <StudioPracticeSection
          genreCode={mainGenreCode}
          genreId={mainGenreId}
          practices={practices}
          generations={generations}
          currentUserId={currentUserId}
        />
      ) : null}
    </>
  );
}
