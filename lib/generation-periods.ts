import { addDays, formatDateLabel, isValidDateString } from "@/lib/time";
import type { DateString } from "@/lib/types";

/**
 * 公式練の対象期の期間 (SPEC.md §6.2 Step3 / §5.2 末尾 / v1.51)
 *
 * 対象期は月ではなく期間で決まる (大祭の練習は全期、クリスマスパーティーの練習は24期だけ、など)。
 * 公式練のコマの `target_generations` は DB のトリガが期間から入れるので、ここは
 * **画面で「保存するとどうなるか」を先に見せるための計算**。規則は DB の関数
 * (`save_generation_period` / `refresh_slot_targets`) と同じにしてある。
 */

/** 期間 (generation_periods の1行)。generations が null なら全期 */
export interface GenerationPeriod {
  id: string;
  name: string | null;
  startDate: DateString;
  endDate: DateString;
  generations: number[] | null;
  updatedAt: string;
}

/** 編集の窓で直している期間。新しく作るときは id が null */
export interface PeriodDraft {
  id: string | null;
  updatedAt: string | null;
  name: string;
  startDate: DateString;
  endDate: DateString;
  /** 空なら全期 */
  generations: number[];
}

type PeriodRange = Pick<GenerationPeriod, "startDate" | "endDate" | "generations">;

/** 保存したあとの期間。縮んだ・分かれた期間は元の期間を `sourceId` に持つ */
export interface AppliedPeriod extends PeriodRange {
  id: string | null;
  name: string | null;
  sourceId: string | null;
}

export const PERIOD_NAME_MAX = 40;

export const GENERATION_PERIOD_COLUMNS =
  "id, name, start_date, end_date, generations, updated_at";

export interface GenerationPeriodRow {
  id: string;
  name: string | null;
  start_date: string;
  end_date: string;
  generations: number[] | null;
  updated_at: string;
}

export function fromRow(row: GenerationPeriodRow): GenerationPeriod {
  return {
    id: row.id,
    name: row.name,
    startDate: row.start_date as DateString,
    endDate: row.end_date as DateString,
    generations: row.generations,
    updatedAt: row.updated_at,
  };
}

/** 同じ期は1つにし、大きい期から並べる。空は全期 (null)。DB と同じ持ち方 */
export function normalizeGenerations(
  list: readonly number[] | null | undefined,
): number[] | null {
  if (!list || list.length === 0) return null;
  return [...new Set(list)].sort((a, b) => b - a);
}

/**
 * 2つの対象期が同じか。**DB と同じく並びまで比べる** (`is distinct from`)。
 * 期間の値は保存のときに並べ直されるので、ふだんは並びの違いは出ない。
 */
export function sameTarget(
  a: readonly number[] | null,
  b: readonly number[] | null,
): boolean {
  if (a === null || b === null) return a === b;
  return a.length === b.length && a.every((g, i) => g === b[i]);
}

/** 「24・23期」/「全期」 */
export function formatGenerations(generations: readonly number[] | null): string {
  return generations && generations.length > 0 ? `${generations.join("・")}期` : "全期";
}

/** 「11/16(月)〜12/12(土)」。1日だけなら「11/16(月)」 */
export function formatPeriodRange(startDate: DateString, endDate: DateString): string {
  return startDate === endDate
    ? formatDateLabel(startDate)
    : `${formatDateLabel(startDate)}〜${formatDateLabel(endDate)}`;
}

/** その日の対象期。どの期間にも入らなければ全期 (null) */
export function targetOn(periods: readonly PeriodRange[], date: DateString): number[] | null {
  return periods.find((p) => p.startDate <= date && date <= p.endDate)?.generations ?? null;
}

/** [from, to] にかかる期間 */
export function periodsOverlapping<T extends PeriodRange>(
  periods: readonly T[],
  from: DateString,
  to: DateString,
): T[] {
  return periods.filter((p) => p.startDate <= to && p.endDate >= from);
}

/**
 * 期間を保存したあとの並び (DB の `save_generation_period` と同じ規則)。
 *
 * **保存する期間が優先**: 重なる期間は短くし、中に収まる期間は消し、
 * 両側にはみ出す期間は2つに分ける (後ろ半分は新しい行になる)。
 */
export function applyPeriod(
  periods: readonly GenerationPeriod[],
  draft: {
    id: string | null;
    name: string | null;
    startDate: DateString;
    endDate: DateString;
    generations: readonly number[] | null;
  },
): AppliedPeriod[] {
  const result: AppliedPeriod[] = [];
  for (const p of periods) {
    if (p.id === draft.id) continue;
    const base = { id: p.id, name: p.name, generations: p.generations, sourceId: p.id };
    if (p.endDate < draft.startDate || p.startDate > draft.endDate) {
      result.push({ ...base, startDate: p.startDate, endDate: p.endDate });
      continue;
    }
    const front = p.startDate < draft.startDate;
    if (front) {
      result.push({ ...base, startDate: p.startDate, endDate: addDays(draft.startDate, -1) });
    }
    if (p.endDate > draft.endDate) {
      result.push({
        ...base,
        // 前も残るなら後ろは新しい行
        id: front ? null : p.id,
        startDate: addDays(draft.endDate, 1),
        endDate: p.endDate,
      });
    }
  }
  result.push({
    id: draft.id,
    name: draft.name,
    startDate: draft.startDate,
    endDate: draft.endDate,
    generations: normalizeGenerations(draft.generations),
    sourceId: draft.id,
  });
  return result.sort((a, b) => a.startDate.localeCompare(b.startDate));
}

/** 期間を1つ消したあとの並び */
export function removePeriod(
  periods: readonly GenerationPeriod[],
  id: string,
): GenerationPeriod[] {
  return periods.filter((p) => p.id !== id);
}

/**
 * 保存でほかの期間がどうなるか (確認の窓に出す1行ずつ)。
 * 「大祭 8/10(月)〜11/30(月) → 8/10(月)〜11/15(日)」「冬 12/1(火)〜12/5(土) を消す」
 */
export function describeOtherChanges(
  before: readonly GenerationPeriod[],
  after: readonly AppliedPeriod[],
  draftId: string | null,
): string[] {
  const lines: string[] = [];
  for (const p of before) {
    if (p.id === draftId) continue;
    const label = `${p.name ? `${p.name} ` : ""}${formatPeriodRange(p.startDate, p.endDate)}`;
    const pieces = after.filter((a) => a.sourceId === p.id);
    if (pieces.length === 0) {
      lines.push(`${label} を消す`);
    } else if (pieces.length === 1) {
      const [piece] = pieces;
      if (piece.startDate !== p.startDate || piece.endDate !== p.endDate) {
        lines.push(`${label} → ${formatPeriodRange(piece.startDate, piece.endDate)}`);
      }
    } else {
      lines.push(
        `${label} → ${pieces.map((a) => formatPeriodRange(a.startDate, a.endDate)).join(" と ")}`,
      );
    }
  }
  return lines;
}

/**
 * 保存・削除で対象期を入れ直す日の範囲 (DB と同じ)。前の範囲と新しい範囲の両端。
 * 実際に入れ直すのは今日から先だけ。
 */
export function affectedRange(
  previous: Pick<PeriodRange, "startDate" | "endDate"> | null,
  next: Pick<PeriodRange, "startDate" | "endDate"> | null,
): { from: DateString; to: DateString } | null {
  const ranges = [previous, next].filter((r): r is NonNullable<typeof r> => r !== null);
  if (ranges.length === 0) return null;
  return {
    from: ranges.map((r) => r.startDate).sort()[0],
    to: ranges.map((r) => r.endDate).sort().at(-1)!,
  };
}

/**
 * 保存・削除で対象期が変わる公開済みの公式練 (DB の `refresh_slot_targets` と同じ判定)。
 * 今日から先で、`range` の中にあり、今の値と保存後の期間の値が違うもの。
 */
export function changedSlots<T extends { date: DateString; targetGenerations: number[] | null }>(
  slots: readonly T[],
  after: readonly PeriodRange[],
  range: { from: DateString; to: DateString } | null,
  today: DateString,
): T[] {
  if (!range) return [];
  return slots.filter(
    (s) =>
      s.date >= today &&
      s.date >= range.from &&
      s.date <= range.to &&
      !sameTarget(s.targetGenerations, targetOn(after, s.date)),
  );
}

/** 保存の前の確かめ。問題が無ければ null */
export function validatePeriodDraft(draft: PeriodDraft): string | null {
  if (!isValidDateString(draft.startDate) || !isValidDateString(draft.endDate)) {
    return "開始日と終了日を入れてください。";
  }
  if (draft.endDate < draft.startDate) return "終了日が開始日より前になっています。";
  if (draft.name.trim().length > PERIOD_NAME_MAX) {
    return `名前は${PERIOD_NAME_MAX}文字までです。`;
  }
  return null;
}
