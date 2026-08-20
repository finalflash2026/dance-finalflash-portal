"use client";

import { useRouter } from "next/navigation";
import { useMemo, useState } from "react";

import type { DayBlock } from "@/components/DayGrid";
import { ErrorMessage, buttonClass, inputClass } from "@/components/ui";
import { freeRanges, stepOptions, validateClaim } from "@/lib/claims";
import {
  ROOMS,
  SLOT_CLAIMED_COLOR,
  SLOT_OPEN_COLOR,
  SLOT_UNAVAILABLE_COLOR,
  GENRE_COLORS,
  type GenreCode,
} from "@/lib/constants";
import { createClient } from "@/lib/supabase/client";
import {
  CLAIM_STEP_MINUTES,
  DAY_END_TIME,
  DAY_START_TIME,
  formatDateLabel,
  formatTimeRange,
  toMinutes,
} from "@/lib/time";
import type { DateString } from "@/lib/types";

/**
 * 空き申請シート (SPEC.md §6.1「空き申請フロー」)
 *
 * 1. 対象部屋の当日タイムバー(9〜22時)を描画。不可・公式練・申請済は塞がった表示
 * 2. 空き範囲内で開始/終了を10分刻みで選択。**範囲外は選択肢に出さない**ので
 *    視覚的に選べない (SPEC は「ドラッグまたはプルダウン」を許容しており、
 *    スマホでの確実性とアクセシビリティからプルダウンを採る)
 * 3. 確認画面: 名前(自動)/申請場所/申請日時/用途メモ →「はい/いいえ」
 * 4. claims へ insert。**排他制約違反(23P01)は必ず起こりうる**ので、
 *    「その時間帯は先に申請が入りました」と出して最新状態を取り直す
 */

/** PostgreSQL の排他制約違反。同時申請で必ず片方がこれになる */
const EXCLUSION_VIOLATION = "23P01";
/** 10分刻みの CHECK 制約違反 */
const CHECK_VIOLATION = "23514";

const BAR_HEIGHT = 260;

export function ClaimSheet({
  date,
  slot,
  initialRange,
  roomBlocks,
  currentUserId,
  onClose,
}: {
  date: DateString;
  /** 申請対象の空きコマ */
  slot: DayBlock;
  /** タップした空き区間 */
  initialRange: { startTime: string; endTime: string };
  /** 同じ部屋・同じ日の全 slot。タイムバーの「塞がり」表示に使う */
  roomBlocks: DayBlock[];
  /** 申請者。RLS ins_claims が auth.uid() との一致を要求する */
  currentUserId: string;
  onClose: () => void;
}) {
  const router = useRouter();
  const [confirming, setConfirming] = useState(false);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [purpose, setPurpose] = useState("");

  // タップした区間を含む空き範囲。ここから外は選ばせない
  const range = useMemo(() => {
    const ranges = freeRanges(slot, slot.claims);
    return (
      ranges.find(
        (r) =>
          toMinutes(r.startTime) <= toMinutes(initialRange.startTime) &&
          toMinutes(initialRange.endTime) <= toMinutes(r.endTime),
      ) ??
      ranges[0] ?? { startTime: slot.startTime, endTime: slot.endTime }
    );
  }, [slot, initialRange]);

  const options = useMemo(() => stepOptions(range), [range]);
  const [startTime, setStartTime] = useState(options[0] ?? range.startTime);
  const [endTime, setEndTime] = useState(
    options[1] ?? options[options.length - 1] ?? range.endTime,
  );

  /**
   * 開始を変えたら終了も追従させる。
   * 終了のプルダウンは「開始より後」で絞り込むため、補正しないと
   * 選択肢に無い値が state に残り、表示と実態がズレる。
   */
  function changeStartTime(value: string) {
    setStartTime(value);
    if (toMinutes(endTime) <= toMinutes(value)) {
      const next = options.find((time) => toMinutes(time) > toMinutes(value));
      if (next) setEndTime(next);
    }
  }

  const room = ROOMS.find((r) => r.id === slot.roomId);
  const validation = validateClaim(slot, slot.claims, startTime, endTime);

  async function submit() {
    setPending(true);
    setError(null);

    const supabase = createClient();
    const { error: insertError } = await supabase.from("claims").insert({
      slot_id: slot.id,
      // RLS の ins_claims が user_id = auth.uid() を要求するため、
      // 他人になりすました値を入れても DB で弾かれる
      user_id: currentUserId,
      start_time: startTime,
      end_time: endTime,
      purpose: purpose.trim() || null,
    });

    setPending(false);

    if (insertError) {
      if (insertError.code === EXCLUSION_VIOLATION) {
        // SPEC §6.1-4: 同時申請の重複は DB で必ず片方が失敗する
        setError(
          "その時間帯は先に申請が入りました。最新の状態を読み込みます",
        );
        router.refresh();
        return;
      }
      if (insertError.code === CHECK_VIOLATION) {
        setError(`時刻は${CLAIM_STEP_MINUTES}分刻みで選んでください`);
        return;
      }
      setError(`申請に失敗しました: ${insertError.message}`);
      return;
    }

    onClose();
    router.refresh();
  }

  return (
    <div
      data-no-swipe
      className="backdrop-in fixed inset-0 z-50 flex items-end justify-center bg-black/40 sm:items-center"
    >
      <button
        type="button"
        aria-label="閉じる"
        className="absolute inset-0 h-full w-full cursor-default"
        onClick={onClose}
      />
      <div
        role="dialog"
        aria-modal="true"
        aria-label="空き時間の申請"
        className="sheet-in relative z-10 max-h-[90dvh] w-full max-w-md overflow-y-auto rounded-t-2xl bg-[var(--background)] p-5 sm:rounded-2xl"
      >
        {confirming ? (
          <>
            <h3 className="text-lg font-bold">この内容で申請しますか?</h3>
            <dl className="mt-4 space-y-2 text-sm">
              <Row label="申請場所" value={room?.name ?? "-"} />
              <Row
                label="申請日時"
                value={`${formatDateLabel(date)} ${formatTimeRange(startTime, endTime)}`}
              />
              <Row label="申請内容" value={purpose.trim() || "個人練"} />
            </dl>

            <ErrorMessage>{error}</ErrorMessage>

            <div className="mt-5 space-y-2">
              <button
                type="button"
                onClick={submit}
                disabled={pending}
                className={buttonClass}
              >
                {pending ? "申請中…" : "はい"}
              </button>
              <button
                type="button"
                onClick={() => setConfirming(false)}
                disabled={pending}
                className="w-full rounded-lg border border-[var(--border)] py-3 text-sm font-medium"
              >
                いいえ (戻る)
              </button>
            </div>
          </>
        ) : (
          <>
            <h3 className="text-lg font-bold">空き時間の申請</h3>
            <p className="mt-1 text-sm text-[var(--muted)]">
              {room?.name} / {formatDateLabel(date)}
            </p>

            <div className="mt-4 flex gap-4">
              <TimeBar blocks={roomBlocks} />

              <div className="flex-1 space-y-3">
                <p className="text-xs text-[var(--muted)]">
                  選べる範囲: {formatTimeRange(range.startTime, range.endTime)}
                </p>

                <label className="block">
                  <span className="text-sm font-medium">開始</span>
                  <select
                    className={inputClass}
                    value={startTime}
                    onChange={(e) => changeStartTime(e.target.value)}
                  >
                    {options.slice(0, -1).map((time) => (
                      <option key={time} value={time}>
                        {time}
                      </option>
                    ))}
                  </select>
                </label>

                <label className="block">
                  <span className="text-sm font-medium">終了</span>
                  <select
                    className={inputClass}
                    value={endTime}
                    onChange={(e) => setEndTime(e.target.value)}
                  >
                    {options
                      .filter((time) => toMinutes(time) > toMinutes(startTime))
                      .map((time) => (
                        <option key={time} value={time}>
                          {time}
                        </option>
                      ))}
                  </select>
                </label>

                <label className="block">
                  <span className="text-sm font-medium">
                    用途メモ{" "}
                    <span className="font-normal text-[var(--muted)]">
                      (任意)
                    </span>
                  </span>
                  <input
                    className={inputClass}
                    value={purpose}
                    onChange={(e) => setPurpose(e.target.value)}
                    maxLength={40}
                    placeholder="個人練"
                  />
                </label>
              </div>
            </div>

            {!validation.ok ? (
              <p className="mt-3 text-sm text-[var(--danger-fg)]">
                {validation.message}
              </p>
            ) : null}
            <ErrorMessage>{error}</ErrorMessage>

            <div className="mt-5 space-y-2">
              <button
                type="button"
                onClick={() => {
                  setError(null);
                  setConfirming(true);
                }}
                disabled={!validation.ok}
                className={buttonClass}
              >
                確認へ進む
              </button>
              <button
                type="button"
                onClick={onClose}
                className="w-full rounded-lg border border-[var(--border)] py-3 text-sm font-medium"
              >
                キャンセル
              </button>
            </div>
          </>
        )}
      </div>
    </div>
  );
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex gap-3">
      <dt className="w-20 shrink-0 text-[var(--muted)]">{label}</dt>
      <dd className="font-medium">{value}</dd>
    </div>
  );
}

/**
 * その部屋の当日タイムバー (SPEC §6.1-1)。
 * 公式練・使用不可・申請済は塞がった表示にして、空きの位置を把握しやすくする。
 */
function TimeBar({ blocks }: { blocks: DayBlock[] }) {
  const dayStart = toMinutes(DAY_START_TIME);
  const dayEnd = toMinutes(DAY_END_TIME);
  const scale = BAR_HEIGHT / (dayEnd - dayStart);

  const bars = blocks.flatMap((block) => {
    if (block.status !== "open") {
      return [
        {
          key: block.id,
          start: toMinutes(block.startTime),
          end: toMinutes(block.endTime),
          color:
            block.status === "unavailable"
              ? SLOT_UNAVAILABLE_COLOR.bg
              : ((block.genreCode as GenreCode | null) &&
                  GENRE_COLORS[block.genreCode as GenreCode]?.bg) ||
                SLOT_UNAVAILABLE_COLOR.bg,
        },
      ];
    }
    return [
      {
        key: `${block.id}-open`,
        start: toMinutes(block.startTime),
        end: toMinutes(block.endTime),
        color: SLOT_OPEN_COLOR.bg,
      },
      ...block.claims.map((claim) => ({
        key: claim.id,
        start: toMinutes(claim.startTime),
        end: toMinutes(claim.endTime),
        color: SLOT_CLAIMED_COLOR.bg,
      })),
    ];
  });

  return (
    <div className="shrink-0" aria-hidden>
      <div
        className="relative w-10 rounded border border-[var(--border)] bg-[var(--surface)]"
        style={{ height: BAR_HEIGHT }}
      >
        {bars.map((bar) => (
          <div
            key={bar.key}
            className="absolute inset-x-0"
            style={{
              top: (bar.start - dayStart) * scale,
              height: (bar.end - bar.start) * scale,
              backgroundColor: bar.color,
            }}
          />
        ))}
      </div>
      <div className="mt-1 flex flex-col text-[10px] text-[var(--muted)]">
        <span>{DAY_START_TIME}</span>
        <span>〜{DAY_END_TIME}</span>
      </div>
    </div>
  );
}
