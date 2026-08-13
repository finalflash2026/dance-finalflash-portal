"use client";

import { useEffect, useState } from "react";

import { ErrorMessage, buttonClass, secondaryButtonClass } from "@/components/ui";
import {
  GENRES,
  GENRE_BY_ID,
  GENRE_COLORS,
  ROOM_BY_ID,
  type GenreCode,
} from "@/lib/constants";
import {
  SLOT_PRESET_MINUTES,
  SLOT_STATUS_LABELS,
  invalidatedClaims,
  splitReservation,
  validateSlot,
  type SlotClaimInfo,
  type SlotDraft,
  type SlotInfo,
} from "@/lib/slots";
import { createClient } from "@/lib/supabase/client";
import {
  finalizeTimeInput,
  formatDateLabel,
  formatTimeRange,
  fromMinutes,
  normalizeTimeInput,
  todayInTokyo,
  toMinutes,
  startOfMonth,
} from "@/lib/time";
import type { DateString, SlotStatus } from "@/lib/types";

import { MonthNav } from "./MonthNav";
import {
  useMonthReservations,
  type ReservationInfo,
} from "./useMonthReservations";

/**
 * Step2: コマ割りエディタ (SPEC.md §6.2 Step2)
 *
 * 予約枠(第1層)を公式練・空き・使用不可のコマ(第2層)に割る。
 * 書き込みはブラウザから RLS 経由で直接行う (mod_slots が coordinator 以上を
 * 許可しているため)。検証は lib/slots.ts と DB の制約の二段構え。
 *
 * **未割当区間は DB 行を作らない** (SPEC §6.2 Step2-4)。
 * 予約枠とコマの差分として計算して表示するだけ。
 */

export function SlotStep() {
  const [month, setMonth] = useState<DateString>(() =>
    startOfMonth(todayInTokyo()),
  );
  const { reservations, generations, loading, error, reload, setError } =
    useMonthReservations(month);
  const [editing, setEditing] = useState<{
    reservation: ReservationInfo;
    draft: SlotDraft;
  } | null>(null);
  const [pending, setPending] = useState(false);

  const supabase = createClient();

  /**
   * 予約枠の取消 (SPEC §6.2 Step2-5 / v1.8.1)
   *
   * **コマを先に消してから status を変える。** 逆順だと、途中で失敗したときに
   * 「取消済なのに公開コマが残っている」= カレンダーに幽霊の練習が出続ける
   * 状態になる。コマを先に消せば、最悪でも「枠が active のまま」で済み、
   * もう一度取り消せば回復できる。
   */
  async function cancelReservation(reservation: ReservationInfo) {
    const claims = reservation.slots.flatMap((slot) => slot.claims);
    const lines = [
      `${formatDateLabel(reservation.date)} ${ROOM_BY_ID.get(reservation.roomId)?.name ?? ""}`,
      `${formatTimeRange(reservation.startTime, reservation.endTime)} の予約枠を取り消します。`,
    ];
    if (reservation.slots.length > 0) {
      lines.push(`\nこの枠のコマ ${reservation.slots.length}件も削除されます。`);
    }
    if (claims.length > 0) {
      lines.push(
        `\n以下の空き申請も取り消されます。本人に連絡してください:\n${formatClaimList(claims)}`,
      );
    }
    if (!window.confirm(lines.join("\n"))) return;

    setPending(true);
    setError(null);

    const { error: slotsError } = await supabase
      .from("slots")
      .delete()
      .eq("reservation_id", reservation.id);
    if (slotsError) {
      setPending(false);
      setError(`コマを削除できませんでした: ${slotsError.message}`);
      return;
    }

    const { error: resvError } = await supabase
      .from("reservations")
      .update({ status: "cancelled" })
      .eq("id", reservation.id);

    setPending(false);
    if (resvError) {
      setError(
        `予約枠を取り消せませんでした (コマは削除済みです): ${resvError.message}`,
      );
      return;
    }
    reload();
  }

  async function saveSlot(reservation: ReservationInfo, draft: SlotDraft) {
    const check = validateSlot(reservation, reservation.slots, draft);
    if (!check.ok) {
      setError(check.message);
      return;
    }

    // 公開済の空きコマを変更するときは、成り立たなくなる申請を先に知らせる
    const existing = reservation.slots.find((s) => s.id === draft.id) ?? null;
    const doomed = existing
      ? invalidatedClaims(existing, {
          status: draft.status,
          startTime: draft.startTime,
          endTime: draft.endTime,
        })
      : [];
    if (doomed.length > 0 && !confirmClaimLoss(doomed)) return;

    setPending(true);
    setError(null);

    const payload = {
      start_time: draft.startTime,
      end_time: draft.endTime,
      status: draft.status,
      genre_id: draft.status === "genre" ? draft.genreId : null,
      // 空配列は「全期」と同じ意味なので null に寄せる (SPEC §6.2 Step2-2)
      target_generations:
        draft.targetGenerations && draft.targetGenerations.length > 0
          ? draft.targetGenerations
          : null,
    };

    const { error: writeError } = draft.id
      ? await supabase.from("slots").update(payload).eq("id", draft.id)
      : await supabase.from("slots").insert({
          ...payload,
          reservation_id: reservation.id,
          // date / room_id は予約枠から複製する (slots は表示のため非正規化して持つ)
          date: reservation.date,
          room_id: reservation.roomId,
        });

    setPending(false);
    if (writeError) {
      setError(describeSlotError(writeError));
      return;
    }
    setEditing(null);
    reload();
  }

  async function deleteSlot(slot: SlotInfo) {
    const doomed = invalidatedClaims(slot, null);
    if (doomed.length > 0 && !confirmClaimLoss(doomed)) return;
    if (
      doomed.length === 0 &&
      !window.confirm(
        `${formatTimeRange(slot.startTime, slot.endTime)} のコマを削除しますか?`,
      )
    ) {
      return;
    }

    setPending(true);
    setError(null);
    const { error: deleteError } = await supabase
      .from("slots")
      .delete()
      .eq("id", slot.id);
    setPending(false);

    if (deleteError) {
      setError(`コマを削除できませんでした: ${deleteError.message}`);
      return;
    }
    setEditing(null);
    reload();
  }

  return (
    <div className="space-y-4">
      <MonthNav month={month} onChange={setMonth} disabled={pending} />
      <ErrorMessage>{error}</ErrorMessage>

      {loading ? (
        <p className="rounded-xl border border-[var(--border)] px-4 py-8 text-center text-sm text-[var(--muted)]">
          読み込み中…
        </p>
      ) : reservations.length === 0 ? (
        <p className="rounded-xl border border-[var(--border)] px-4 py-8 text-center text-sm text-[var(--muted)]">
          この月の予約枠はありません。①CSV取込 から登録してください
        </p>
      ) : (
        <ul className="space-y-3">
          {reservations.map((reservation) => (
            <ReservationCard
              key={reservation.id}
              reservation={reservation}
              disabled={pending}
              onCancel={() => cancelReservation(reservation)}
              onEdit={(draft) => {
                setError(null);
                setEditing({ reservation, draft });
              }}
            />
          ))}
        </ul>
      )}

      {editing ? (
        <SlotEditor
          reservation={editing.reservation}
          initial={editing.draft}
          generations={generations}
          disabled={pending}
          onSave={(draft) => saveSlot(editing.reservation, draft)}
          onDelete={() => {
            const slot = editing.reservation.slots.find(
              (s) => s.id === editing.draft.id,
            );
            if (slot) deleteSlot(slot);
          }}
          onClose={() => setEditing(null)}
        />
      ) : null}
    </div>
  );
}

function formatClaimList(claims: SlotClaimInfo[]): string {
  return claims
    .map((c) => `・${c.username} ${formatTimeRange(c.startTime, c.endTime)}`)
    .join("\n");
}

/** SPEC §6.2 Step3: 続行時は申請者名を表示して手動連絡を促す */
function confirmClaimLoss(claims: SlotClaimInfo[]): boolean {
  return window.confirm(
    `この変更で次の空き申請が取り消されます。本人に連絡してください:\n\n${formatClaimList(claims)}`,
  );
}

/** DB 側の制約に当たったときに、原因の分かる日本語にする */
function describeSlotError(error: { code?: string; message: string }): string {
  if (error.code === "23P01") {
    return "同じ予約枠の中でコマの時間が重なっています。画面を再読み込みして確認してください";
  }
  if (error.code === "23514") {
    return "コマの内容が不正です (時刻の前後、または公式練のジャンル未設定)";
  }
  return `保存できませんでした: ${error.message}`;
}

function ReservationCard({
  reservation,
  disabled,
  onCancel,
  onEdit,
}: {
  reservation: ReservationInfo;
  disabled: boolean;
  onCancel: () => void;
  onEdit: (draft: SlotDraft) => void;
}) {
  const segments = splitReservation(reservation, reservation.slots);
  const room = ROOM_BY_ID.get(reservation.roomId);

  return (
    <li className="space-y-2 rounded-xl border border-[var(--border)] p-3">
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <p className="text-sm font-bold">
            {formatDateLabel(reservation.date)} {room?.name ?? "?"}
          </p>
          <p className="text-xs text-[var(--muted)]">
            {formatTimeRange(reservation.startTime, reservation.endTime)}
          </p>
        </div>
        <button
          type="button"
          onClick={onCancel}
          disabled={disabled}
          className="shrink-0 rounded border border-[var(--border)] px-2 py-1 text-xs"
        >
          枠を取消
        </button>
      </div>

      <ul className="divide-y divide-[var(--border)] rounded-lg border border-[var(--border)]">
        {segments.map((segment) =>
          segment.kind === "slot" ? (
            <SlotRow
              key={segment.slot.id}
              slot={segment.slot}
              disabled={disabled}
              onEdit={() =>
                onEdit({
                  id: segment.slot.id,
                  startTime: segment.slot.startTime,
                  endTime: segment.slot.endTime,
                  status: segment.slot.status,
                  genreId: segment.slot.genreId,
                  targetGenerations: segment.slot.targetGenerations,
                })
              }
            />
          ) : (
            <li
              key={`gap-${segment.startTime}`}
              className="flex items-center justify-between gap-2 px-3 py-2"
            >
              <span className="text-sm text-[var(--muted)]">
                <span className="tabular-nums">
                  {formatTimeRange(segment.startTime, segment.endTime)}
                </span>{" "}
                未割当
              </span>
              <button
                type="button"
                disabled={disabled}
                onClick={() =>
                  onEdit({
                    id: null,
                    startTime: segment.startTime,
                    endTime: segment.endTime,
                    status: "genre",
                    genreId: null,
                    targetGenerations: null,
                  })
                }
                className="shrink-0 rounded border border-[var(--border)] px-2 py-1 text-xs"
              >
                コマを作る
              </button>
            </li>
          ),
        )}
      </ul>
    </li>
  );
}

function SlotRow({
  slot,
  disabled,
  onEdit,
}: {
  slot: SlotInfo;
  disabled: boolean;
  onEdit: () => void;
}) {
  const genre = slot.genreId !== null ? GENRE_BY_ID.get(slot.genreId) : null;
  const color = genre ? GENRE_COLORS[genre.code as GenreCode] : null;

  return (
    <li className="flex items-center justify-between gap-2 px-3 py-2">
      <div className="min-w-0">
        <p className="text-sm">
          <span className="tabular-nums text-[var(--muted)]">
            {formatTimeRange(slot.startTime, slot.endTime)}
          </span>{" "}
          {genre && color ? (
            <span
              className="rounded px-1.5 py-0.5 text-xs font-bold"
              style={{ backgroundColor: color.bg, color: color.fg }}
            >
              {genre.code}
            </span>
          ) : null}{" "}
          <span className="font-medium">{SLOT_STATUS_LABELS[slot.status]}</span>
        </p>
        <p className="text-xs text-[var(--muted)]">
          {slot.published ? "公開済" : "下書き"}
          {slot.targetGenerations && slot.targetGenerations.length > 0
            ? ` / ${slot.targetGenerations.join("・")}期`
            : " / 全期"}
          {slot.claims.length > 0 ? ` / 申請${slot.claims.length}件` : ""}
        </p>
      </div>
      <button
        type="button"
        onClick={onEdit}
        disabled={disabled}
        className="shrink-0 rounded border border-[var(--border)] px-2 py-1 text-xs"
      >
        編集
      </button>
    </li>
  );
}

function SlotEditor({
  reservation,
  initial,
  generations,
  disabled,
  onSave,
  onDelete,
  onClose,
}: {
  reservation: ReservationInfo;
  initial: SlotDraft;
  generations: number[];
  disabled: boolean;
  onSave: (draft: SlotDraft) => void;
  onDelete: () => void;
  onClose: () => void;
}) {
  const [draft, setDraft] = useState<SlotDraft>(initial);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [onClose]);

  const check = validateSlot(reservation, reservation.slots, draft);
  const cell =
    "w-full rounded-lg border border-[var(--border)] bg-[var(--background)] px-2 py-1.5 text-sm outline-none focus:border-[var(--foreground)]";

  /** プリセット: 開始時刻から N 分後を終了にする。予約枠の終わりは超えない */
  function applyPreset(minutes: number) {
    const start = toMinutes(draft.startTime);
    if (Number.isNaN(start)) return;
    const end = Math.min(start + minutes, toMinutes(reservation.endTime));
    setDraft((prev) => ({ ...prev, endTime: fromMinutes(end) }));
  }

  function toggleGeneration(generation: number) {
    setDraft((prev) => {
      const current = prev.targetGenerations ?? [];
      const next = current.includes(generation)
        ? current.filter((g) => g !== generation)
        : [...current, generation].sort((a, b) => b - a);
      return { ...prev, targetGenerations: next.length > 0 ? next : null };
    });
  }

  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/40 sm:items-center">
      <button
        type="button"
        aria-label="閉じる"
        className="absolute inset-0 h-full w-full cursor-default"
        onClick={onClose}
      />
      <div
        role="dialog"
        aria-modal="true"
        className="relative z-10 max-h-[90dvh] w-full max-w-md space-y-4 overflow-y-auto rounded-t-2xl bg-[var(--background)] p-4 sm:rounded-2xl"
      >
        <div>
          <h3 className="text-base font-bold">
            {draft.id ? "コマを編集" : "コマを作る"}
          </h3>
          <p className="text-xs text-[var(--muted)]">
            {formatDateLabel(reservation.date)}{" "}
            {ROOM_BY_ID.get(reservation.roomId)?.name} / 予約枠{" "}
            {formatTimeRange(reservation.startTime, reservation.endTime)}
          </p>
        </div>

        <div className="space-y-2">
          <div className="flex items-center gap-2">
            <input
              aria-label="開始時刻"
              value={draft.startTime}
              inputMode="numeric"
              disabled={disabled}
              onChange={(e) =>
                setDraft((p) => ({
                  ...p,
                  startTime: normalizeTimeInput(e.target.value),
                }))
              }
              onBlur={(e) =>
                setDraft((p) => ({
                  ...p,
                  startTime: finalizeTimeInput(e.target.value),
                }))
              }
              className={cell}
            />
            <span className="text-sm">〜</span>
            <input
              aria-label="終了時刻"
              value={draft.endTime}
              inputMode="numeric"
              disabled={disabled}
              onChange={(e) =>
                setDraft((p) => ({
                  ...p,
                  endTime: normalizeTimeInput(e.target.value),
                }))
              }
              onBlur={(e) =>
                setDraft((p) => ({
                  ...p,
                  endTime: finalizeTimeInput(e.target.value),
                }))
              }
              className={cell}
            />
          </div>
          <div className="flex gap-2">
            {SLOT_PRESET_MINUTES.map((minutes) => (
              <button
                key={minutes}
                type="button"
                disabled={disabled}
                onClick={() => applyPreset(minutes)}
                className="rounded border border-[var(--border)] px-3 py-1 text-xs"
              >
                {minutes}分
              </button>
            ))}
            <span className="self-center text-xs text-[var(--muted)]">
              数字だけでも入力できます (1700 → 17:00)
            </span>
          </div>
        </div>

        <div className="space-y-1">
          <p className="text-sm font-medium">状態</p>
          <div className="flex gap-2">
            {(Object.keys(SLOT_STATUS_LABELS) as SlotStatus[]).map((status) => (
              <button
                key={status}
                type="button"
                disabled={disabled}
                onClick={() => setDraft((p) => ({ ...p, status }))}
                aria-pressed={draft.status === status}
                className={`flex-1 rounded-lg border px-2 py-2 text-sm ${
                  draft.status === status
                    ? "border-[var(--foreground)] bg-[var(--foreground)] font-bold text-white"
                    : "border-[var(--border)]"
                }`}
              >
                {SLOT_STATUS_LABELS[status]}
              </button>
            ))}
          </div>
        </div>

        {draft.status === "genre" ? (
          <label className="block">
            <span className="text-sm font-medium">ジャンル</span>
            <select
              className={`${cell} mt-1`}
              value={draft.genreId ?? ""}
              disabled={disabled}
              onChange={(e) =>
                setDraft((p) => ({
                  ...p,
                  genreId: e.target.value ? Number(e.target.value) : null,
                }))
              }
            >
              <option value="">選んでください</option>
              {GENRES.map((genre) => (
                <option key={genre.id} value={genre.id}>
                  {genre.code}
                </option>
              ))}
            </select>
          </label>
        ) : null}

        <div className="space-y-1">
          <p className="text-sm font-medium">
            対象期{" "}
            <span className="font-normal text-[var(--muted)]">
            (未選択=全期)
            </span>
          </p>
          {generations.length === 0 ? (
            <p className="text-xs text-[var(--muted)]">登録者がいません</p>
          ) : (
            <div className="flex flex-wrap gap-2">
              {generations.map((generation) => {
                const on = (draft.targetGenerations ?? []).includes(generation);
                return (
                  <button
                    key={generation}
                    type="button"
                    disabled={disabled}
                    onClick={() => toggleGeneration(generation)}
                    aria-pressed={on}
                    className={`rounded-full border px-3 py-1 text-sm ${
                      on
                        ? "border-[var(--foreground)] bg-[var(--foreground)] font-bold text-white"
                        : "border-[var(--border)]"
                    }`}
                  >
                    {generation}期
                  </button>
                );
              })}
            </div>
          )}
        </div>

        {!check.ok ? (
          <p role="alert" className="text-sm font-medium text-[#8B1A10]">
            {check.message}
          </p>
        ) : null}

        <div className="space-y-2">
          <button
            type="button"
            disabled={disabled || !check.ok}
            onClick={() => onSave(draft)}
            className={buttonClass}
          >
            保存する
          </button>
          {draft.id ? (
            <button
              type="button"
              disabled={disabled}
              onClick={onDelete}
              className={`${secondaryButtonClass} text-[#8B1A10]`}
            >
              このコマを削除する
            </button>
          ) : null}
          <button
            type="button"
            onClick={onClose}
            className={secondaryButtonClass}
          >
            閉じる
          </button>
        </div>
      </div>
    </div>
  );
}
