"use client";

import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";

import { ClaimSheet } from "@/components/ClaimSheet";
import {
  GENRE_COLORS,
  SLOT_CLAIMED_COLOR,
  SLOT_OPEN_COLOR,
  SLOT_UNAVAILABLE_COLOR,
  type GenreCode,
} from "@/lib/constants";
import { splitOpenSlot, type ClaimInfo, type OpenSegment } from "@/lib/claims";
import { useRoomById, useRoomSections } from "@/lib/rooms";
import { createClient } from "@/lib/supabase/client";
import {
  DAY_END_TIME,
  DAY_START_TIME,
  TIMELINE_STEP_MINUTES,
  formatDateLabel,
  formatTimeRange,
  fromMinutes,
  toMinutes,
} from "@/lib/time";
import type { DateString, SlotStatus } from "@/lib/types";

/**
 * 日別詳細ビュー (SPEC.md §6.1)
 *
 * - **列=練習場所 / 行=時間** のグリッド (Excel表の1日分に相当)
 * - 列は rooms を section ごとにグループ化した固定順 (§4.2)。
 *   その日 slot が1件も無い部屋列は非表示にして幅を節約する
 * - 行は 09:00〜22:00 の時間軸 (30分刻みの目盛)
 * - **空きコマ (status='open') は枠内をさらに分割**して描く:
 *   申請済の時間帯は申請者username入りブロック、残りは「空き」ブロック
 * - 横スクロール可。時間軸列は sticky 固定
 */

export interface DayBlock {
  id: string;
  roomId: number;
  startTime: string;
  endTime: string;
  status: SlotStatus;
  genreCode: string | null;
  targetGenerations: number[] | null;
  note: string | null;
  /** status='open' のときのみ意味を持つ */
  claims: ClaimInfo[];
}

const COLUMN_WIDTH = 112;
const TIME_COLUMN_WIDTH = 44;
/**
 * 縦の縮尺。09:00〜22:00 = 780分なので、この値が日別ビューの高さを決める。
 * 1.2 だと 936px あり、施錠ボードとミニカレンダーの下でほぼ画面外だった。
 * 0.8 = 624px なら、90分のコマでも 72px 取れて2行の文字が収まる。
 */
const PX_PER_MINUTE = 0.8;
/** これより低いブロックは時刻の行を省く (label だけにする) */
const COMPACT_BLOCK_HEIGHT = 30;

/** グリッド上に描く1ブロック。slot そのものか、空きコマを分割した区間 */
type Drawable = {
  key: string;
  roomId: number;
  startTime: string;
  endTime: string;
  label: string;
  color: { bg: string; fg: string };
  slot: DayBlock;
  segment: OpenSegment | null;
};

export function DayGrid({
  date,
  blocks,
  currentUserId,
}: {
  date: DateString;
  blocks: DayBlock[];
  currentUserId: string;
  /** 折衝以上か。他人の申請も取消せる (SPEC §6.1-5) */
}) {
  const [selected, setSelected] = useState<Drawable | null>(null);
  const [claiming, setClaiming] = useState<{
    slot: DayBlock;
    range: { startTime: string; endTime: string };
  } | null>(null);

  const sections = useRoomSections();
  const dayStart = toMinutes(DAY_START_TIME);
  const dayEnd = toMinutes(DAY_END_TIME);
  const totalHeight = (dayEnd - dayStart) * PX_PER_MINUTE;

  // その日に slot がある部屋だけを §4.2 の順で、section ごとにまとめる
  const usedRoomIds = new Set(blocks.map((b) => b.roomId));
  const groups = sections
    .map((group) => ({
      section: group.section,
      rooms: group.rooms.filter((r) => usedRoomIds.has(r.id)),
    }))
    .filter((g) => g.rooms.length > 0);
  const flatRooms = groups.flatMap((g) => g.rooms);

  const ticks: number[] = [];
  for (let m = dayStart; m <= dayEnd; m += TIMELINE_STEP_MINUTES) ticks.push(m);

  const drawables = blocks.flatMap(toDrawables);

  if (flatRooms.length === 0) {
    return (
      <p className="rounded-xl border border-[var(--border)] px-4 py-8 text-center text-sm text-[var(--muted)]">
        {formatDateLabel(date)} の練習予定はありません
      </p>
    );
  }

  return (
    <>
      {/*
       * h-scroll: iOS の既定はオーバーレイ式で右に続きがあると気付けないため常時表示にする。
       * overflow-y-hidden を明示するのが重要 — CSS は overflow-x だけを auto に
       * すると overflow-y の visible を auto に計算しなおすため、9:00〜22:00 が
       * すべて収まっているのに数pxだけ縦スクロールできる状態になっていた。
       * 高さは中身なりで、外から制限していないので隠れる部分は無い。
       */}
      <div className="h-scroll overflow-x-auto overflow-y-hidden rounded-xl border border-[var(--border)]">
        <div className="w-max">
          {/* section 見出し */}
          <div className="flex border-b border-[var(--border)] bg-[var(--surface)]">
            <div
              className="sticky left-0 z-20 shrink-0 bg-[var(--surface)]"
              style={{ width: TIME_COLUMN_WIDTH }}
            />
            {groups.map((group) => (
              <div
                key={group.section}
                className="shrink-0 border-l border-[var(--border)] px-1 py-1 text-center text-xs font-bold"
                style={{ width: group.rooms.length * COLUMN_WIDTH }}
              >
                {group.section}
              </div>
            ))}
          </div>

          {/* 部屋名 */}
          <div className="flex border-b border-[var(--border)]">
            <div
              className="sticky left-0 z-20 shrink-0 bg-[var(--background)]"
              style={{ width: TIME_COLUMN_WIDTH }}
            />
            {flatRooms.map((room) => (
              <div
                key={room.id}
                className="shrink-0 border-l border-[var(--border)] px-1 py-1 text-center text-[10px] leading-tight"
                style={{ width: COLUMN_WIDTH }}
              >
                {room.name}
              </div>
            ))}
          </div>

          {/* 本体 */}
          <div className="flex" style={{ height: totalHeight }}>
            {/* 時間軸 (sticky) */}
            <div
              className="sticky left-0 z-20 relative shrink-0 bg-[var(--background)]"
              style={{ width: TIME_COLUMN_WIDTH }}
            >
              {ticks.map((minute) => (
                <div
                  key={minute}
                  className="absolute right-1 -translate-y-1/2 text-[10px] text-[var(--muted)]"
                  style={{ top: (minute - dayStart) * PX_PER_MINUTE }}
                >
                  {minute % 60 === 0 ? fromMinutes(minute) : ""}
                </div>
              ))}
            </div>

            {flatRooms.map((room) => (
              <div
                key={room.id}
                className="relative shrink-0 border-l border-[var(--border)]"
                style={{ width: COLUMN_WIDTH }}
              >
                {/* 目盛線 */}
                {ticks.map((minute) => (
                  <div
                    key={minute}
                    className="absolute inset-x-0 border-t"
                    style={{
                      top: (minute - dayStart) * PX_PER_MINUTE,
                      borderColor:
                        minute % 60 === 0 ? "var(--border)" : "transparent",
                    }}
                  />
                ))}

                {drawables
                  .filter((d) => d.roomId === room.id)
                  .map((drawable) => (
                    <GridBlock
                      key={drawable.key}
                      drawable={drawable}
                      dayStart={dayStart}
                      dayEnd={dayEnd}
                      onSelect={setSelected}
                    />
                  ))}
              </div>
            ))}
          </div>
        </div>
      </div>

      {selected ? (
        <DetailModal
          drawable={selected}
          date={date}
          currentUserId={currentUserId}
          onClose={() => setSelected(null)}
          onClaim={(slot, range) => {
            setSelected(null);
            setClaiming({ slot, range });
          }}
        />
      ) : null}

      {claiming ? (
        <ClaimSheet
          date={date}
          slot={claiming.slot}
          initialRange={claiming.range}
          roomBlocks={blocks.filter((b) => b.roomId === claiming.slot.roomId)}
          currentUserId={currentUserId}
          onClose={() => setClaiming(null)}
        />
      ) : null}
    </>
  );
}

/**
 * slot を描画単位に展開する。
 * 空きコマだけは splitOpenSlot() で「申請済み」「空き」に割る (SPEC §6.1)。
 */
function toDrawables(slot: DayBlock): Drawable[] {
  if (slot.status !== "open") {
    return [
      {
        key: slot.id,
        roomId: slot.roomId,
        startTime: slot.startTime,
        endTime: slot.endTime,
        label: slotLabel(slot),
        color: slotColor(slot),
        slot,
        segment: null,
      },
    ];
  }

  return splitOpenSlot(slot, slot.claims).map((segment, index) => ({
    key: `${slot.id}-${index}`,
    roomId: slot.roomId,
    startTime: segment.startTime,
    endTime: segment.endTime,
    label: segment.kind === "claimed" ? segment.claim.username : "空き",
    color: segment.kind === "claimed" ? SLOT_CLAIMED_COLOR : SLOT_OPEN_COLOR,
    slot,
    segment,
  }));
}

function GridBlock({
  drawable,
  dayStart,
  dayEnd,
  onSelect,
}: {
  drawable: Drawable;
  dayStart: number;
  dayEnd: number;
  onSelect: (drawable: Drawable) => void;
}) {
  // 表示範囲 (09:00〜22:00) の外にはみ出す slot は端で切って描く
  const start = Math.max(toMinutes(drawable.startTime), dayStart);
  const end = Math.min(toMinutes(drawable.endTime), dayEnd);
  if (end <= start) return null;

  const height = (end - start) * PX_PER_MINUTE;
  // 短いコマで2行を描くと両方とも切れて読めなくなる。
  // 名前のほうが情報量が多いので、入らないときは時刻を落とす
  const compact = height < COMPACT_BLOCK_HEIGHT;

  return (
    <button
      type="button"
      onClick={() => onSelect(drawable)}
      title={`${drawable.label} ${formatTimeRange(drawable.startTime, drawable.endTime)}`}
      className="absolute inset-x-0.5 overflow-hidden rounded px-1 py-0.5 text-left text-[11px] leading-tight"
      style={{
        top: (start - dayStart) * PX_PER_MINUTE,
        height,
        backgroundColor: drawable.color.bg,
        color: drawable.color.fg,
      }}
    >
      <span className="block truncate font-bold">{drawable.label}</span>
      {compact ? null : (
        <span className="block opacity-80">
          {formatTimeRange(drawable.startTime, drawable.endTime)}
        </span>
      )}
    </button>
  );
}

function slotColor(slot: DayBlock) {
  if (slot.status === "unavailable") return SLOT_UNAVAILABLE_COLOR;
  const code = slot.genreCode as GenreCode | null;
  return code && code in GENRE_COLORS
    ? GENRE_COLORS[code]
    : SLOT_UNAVAILABLE_COLOR;
}

function slotLabel(slot: DayBlock): string {
  if (slot.status === "unavailable") return "×";
  const generations = slot.targetGenerations?.length
    ? `(${slot.targetGenerations.join("・")}期)`
    : "";
  return `${slot.genreCode ?? "?"}${generations}`;
}

/**
 * ブロックタップで開く詳細 (SPEC §6.1)
 * 時間・部屋・ジャンル/申請者・note、自分の申請なら取消ボタン。
 * 空きブロックからは申請シートへ進む。
 */
function DetailModal({
  drawable,
  date,
  currentUserId,
  onClose,
  onClaim,
}: {
  drawable: Drawable;
  date: DateString;
  currentUserId: string;
  onClose: () => void;
  onClaim: (
    slot: DayBlock,
    range: { startTime: string; endTime: string },
  ) => void;
}) {
  const router = useRouter();
  const roomById = useRoomById();
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [onClose]);

  const room = roomById.get(drawable.roomId);
  const segment = drawable.segment;
  const claim = segment?.kind === "claimed" ? segment.claim : null;
  const isFree = segment?.kind === "free";
  // 取消は本人 or 折衝以上 (SPEC §6.1-5)。最終的な可否は RLS del_claims が決める
  /*
   * **取り消せるのは申請した本人だけ** (v1.22)。
   * 以前は折衝以上にも出していたが、他人の申請を取り消せてしまうと
   * 報告があった。申請は「その人がその時間に練習する」という本人の
   * 意思表示で、消えたことに本人が気づく手段が無い。
   * RLS 側 (del_claims) でも本人だけに絞ってある。
   */
  const canCancel = claim ? claim.userId === currentUserId : false;

  async function cancelClaim() {
    if (!claim) return;
    if (
      !window.confirm(
        `${formatTimeRange(claim.startTime, claim.endTime)} の申請を取り消しますか?`,
      )
    ) {
      return;
    }
    setPending(true);
    setError(null);

    const supabase = createClient();
    const { error: deleteError } = await supabase
      .from("claims")
      .delete()
      .eq("id", claim.id);

    setPending(false);
    if (deleteError) {
      setError(`取消に失敗しました: ${deleteError.message}`);
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
        aria-label="コマの詳細"
        className="sheet-in relative z-10 w-full max-w-sm rounded-t-2xl bg-[var(--background)] p-5 sm:rounded-2xl"
      >
        <h3 className="text-lg font-bold">{drawable.label}</h3>
        <dl className="mt-3 space-y-2 text-sm">
          <div className="flex gap-3">
            <dt className="w-16 shrink-0 text-[var(--muted)]">日時</dt>
            <dd>
              {formatDateLabel(date)}{" "}
              {formatTimeRange(drawable.startTime, drawable.endTime)}
            </dd>
          </div>
          <div className="flex gap-3">
            <dt className="w-16 shrink-0 text-[var(--muted)]">場所</dt>
            <dd>{room?.name ?? "-"}</dd>
          </div>
          {claim?.purpose ? (
            <div className="flex gap-3">
              <dt className="w-16 shrink-0 text-[var(--muted)]">用途</dt>
              <dd>{claim.purpose}</dd>
            </div>
          ) : null}
          {drawable.slot.targetGenerations?.length ? (
            <div className="flex gap-3">
              <dt className="w-16 shrink-0 text-[var(--muted)]">対象</dt>
              <dd>{drawable.slot.targetGenerations.join("・")}期</dd>
            </div>
          ) : null}
          {drawable.slot.note ? (
            <div className="flex gap-3">
              <dt className="w-16 shrink-0 text-[var(--muted)]">メモ</dt>
              <dd>{drawable.slot.note}</dd>
            </div>
          ) : null}
        </dl>

        {error ? (
          <p
            role="alert"
            className="mt-4 rounded-lg bg-[var(--danger-bg)] px-3 py-2 text-sm text-[var(--danger-fg)]"
          >
            {error}
          </p>
        ) : null}

        <div className="mt-5 space-y-2">
          {isFree ? (
            <button
              type="button"
              onClick={() =>
                onClaim(drawable.slot, {
                  startTime: drawable.startTime,
                  endTime: drawable.endTime,
                })
              }
              className="w-full rounded-lg bg-[var(--primary)] py-3 text-sm font-bold text-[var(--primary-fg)]"
            >
              この時間帯を申請する
            </button>
          ) : null}

          {canCancel ? (
            <button
              type="button"
              onClick={cancelClaim}
              disabled={pending}
              className="w-full rounded-lg border border-[var(--danger-fg)] py-3 text-sm font-bold text-[var(--danger-fg)] disabled:opacity-50"
            >
              {pending ? "取消中…" : "申請を取り消す"}
            </button>
          ) : null}

          <button
            type="button"
            onClick={onClose}
            className="w-full rounded-lg border border-[var(--border)] py-2 text-sm font-medium"
          >
            閉じる
          </button>
        </div>
      </div>
    </div>
  );
}
