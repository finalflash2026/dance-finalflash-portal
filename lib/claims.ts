/**
 * 空き申請 (claims) の時間帯計算 (SPEC.md §6.1)
 *
 * 「空きコマを申請済みと空きに分割する」計算は、タブ①のグリッド描画と
 * 申請シートの選択肢生成の**両方**で必要になる。両者がズレると
 * 「選べたのに申請すると弾かれる」という最悪の挙動になるため、
 * ここに純粋関数として集約して共用する。
 *
 * すべて 'HH:MM' 文字列のまま扱い Date を経由しない (lib/time.ts と同じ方針)。
 */

import {
  CLAIM_STEP_MINUTES,
  fromMinutes,
  isOnStep,
  normalizeTime,
  splitRange,
  toMinutes,
} from "@/lib/time";
import type { TimeString } from "@/lib/types";

export interface ClaimInfo {
  id: string;
  userId: string;
  username: string;
  startTime: TimeString;
  endTime: TimeString;
  purpose: string | null;
}

export interface TimeRange {
  startTime: TimeString;
  endTime: TimeString;
}

/** 空きコマを分割した1区間。申請済みなら claim が入る */
export type OpenSegment =
  | ({ kind: "claimed"; claim: ClaimInfo } & TimeRange)
  | ({ kind: "free" } & TimeRange);

/**
 * 空きコマ (slots.status='open') を「申請済み」「空き」の区間に分割する。
 * SPEC §6.1「枠内をさらに分割表示: 申請済の時間帯は申請者username入りブロック、
 * 残りは『空き』ブロック」
 *
 * claims 同士は DB の排他制約で重ならないことが保証されているので、
 * ここでは重なりを考慮しない。
 *
 * 区間の切り出し自体は lib/time.ts の splitRange() が持つ。
 * 「予約枠 → コマ + 未割当」(SPEC §6.2 Step2-4) がまったく同じ計算なので、
 * 端点の扱いを2箇所で持たないようにしている。
 */
export function splitOpenSlot(
  slot: TimeRange,
  claims: ClaimInfo[],
): OpenSegment[] {
  return splitRange(slot, claims).map((segment) =>
    segment.kind === "filled"
      ? {
          kind: "claimed" as const,
          claim: segment.item,
          startTime: segment.startTime,
          endTime: segment.endTime,
        }
      : {
          kind: "free" as const,
          startTime: segment.startTime,
          endTime: segment.endTime,
        },
  );
}

/** 申請可能な範囲だけを取り出す (申請シートの選択肢の元) */
export function freeRanges(slot: TimeRange, claims: ClaimInfo[]): TimeRange[] {
  return splitOpenSlot(slot, claims)
    .filter((s) => s.kind === "free")
    // 刻み1つぶんも取れない区間は申請できないので落とす
    .filter(
      (s) => toMinutes(s.endTime) - toMinutes(s.startTime) >= CLAIM_STEP_MINUTES,
    )
    .map(({ startTime, endTime }) => ({ startTime, endTime }));
}

/**
 * 範囲内の刻み時刻を列挙する (SPEC §6.1: 10分刻みのプルダウン)。
 * 端点を含むので、開始用にも終了用にもそのまま使える。
 */
export function stepOptions(
  range: TimeRange,
  step: number = CLAIM_STEP_MINUTES,
): TimeString[] {
  const start = Math.ceil(toMinutes(range.startTime) / step) * step;
  const end = Math.floor(toMinutes(range.endTime) / step) * step;
  const options: TimeString[] = [];
  for (let m = start; m <= end; m += step) options.push(fromMinutes(m));
  return options;
}

export type ClaimValidation = { ok: true } | { ok: false; message: string };

/**
 * 申請内容の事前検証 (SPEC §6.1-2「クライアントで即時検証」)
 *
 * DB 側にも同じ制約がある (RLS ins_claims / 排他制約 / claims_ten_minutes CHECK)。
 * ここは**その手前で分かりやすい日本語を出すため**のもので、
 * 認可の最終防衛線ではない (SPEC §13.2)。
 */
export function validateClaim(
  slot: TimeRange,
  claims: ClaimInfo[],
  startTime: string,
  endTime: string,
): ClaimValidation {
  const start = toMinutes(startTime);
  const end = toMinutes(endTime);

  if (end <= start) {
    return { ok: false, message: "終了時刻は開始時刻より後にしてください" };
  }
  if (!isOnStep(startTime) || !isOnStep(endTime)) {
    return {
      ok: false,
      message: `時刻は${CLAIM_STEP_MINUTES}分刻みで選んでください`,
    };
  }
  if (start < toMinutes(slot.startTime) || end > toMinutes(slot.endTime)) {
    return {
      ok: false,
      message: `この空きコマ (${normalizeTime(slot.startTime)}〜${normalizeTime(slot.endTime)}) の範囲内で選んでください`,
    };
  }
  const conflict = claims.find(
    (c) => start < toMinutes(c.endTime) && toMinutes(c.startTime) < end,
  );
  if (conflict) {
    return {
      ok: false,
      message: `${normalizeTime(conflict.startTime)}〜${normalizeTime(conflict.endTime)} は ${conflict.username} が申請済みです`,
    };
  }
  return { ok: true };
}
