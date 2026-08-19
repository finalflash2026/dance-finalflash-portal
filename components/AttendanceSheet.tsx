"use client";

import { useCallback, useEffect, useState } from "react";

import { buttonClass, secondaryButtonClass } from "@/components/ui";
import {
  ATTENDANCE_LABELS,
  ATTENDANCE_TIME_LABELS,
  buildParticipants,
  formatAttendance,
  isValidAttendanceTime,
  type AttendanceRow,
  type Participant,
} from "@/lib/attendance";
import { createClient } from "@/lib/supabase/client";
import {
  finalizeTimeInput,
  formatDateLabel,
  formatTimeRange,
  normalizeTimeInput,
} from "@/lib/time";
import type { AttendanceStatus, DateString } from "@/lib/types";

/**
 * 出欠管理窓 (SPEC.md §6.4.2)
 *
 * タブ②の日別ビューとタブ③の日別タイムラインの**両方**から開く同じ窓。
 * 対象は公式練とナンバー練だけで、空き申請は通常の詳細表示のみ。
 *
 * 上部: 参加者と出欠状況の一覧 (行が無い人は「出席」)
 * 下部: 自分の出欠登録 (欠席 / 遅刻+時刻 / 早退+時刻)
 *
 * **お知らせは出さない (v1.11 で廃止)。** 公式練は参加者が数十人おり、
 * 1人が遅刻を登録するだけで同数のお知らせが生まれていた。出欠の状況は
 * この窓を開けば分かるので、量に見合わないと判断した。
 * DB 側のトリガも 0005 で削除している。
 */

export type AttendanceTarget =
  | {
      kind: "slot";
      /** 書き込み先。まとめた場合は代表のコマ */
      id: string;
      /**
       * まとめた元のコマ全部 (SPEC §6.4-1 / v1.12)。同じ練習で部屋を2つ
       * 押さえていると、**出欠は部屋ごとのコマに付く**。読むときは全部を見て、
       * 書くときは代表に寄せる (寄せないと1人が2行持つことになる)。
       */
      ids: string[];
    }
  | { kind: "numberEvent"; id: string }
  /** 空き申請など、出欠の対象にならないもの (SPEC §6.4.2) */
  | { kind: "info" };

export function AttendanceSheet({
  target,
  title,
  date,
  startTime,
  endTime,
  location,
  currentUserId,
  onClose,
}: {
  target: AttendanceTarget;
  title: string;
  date: DateString;
  startTime: string;
  endTime: string;
  location: string;
  currentUserId: string;
  onClose: () => void;
}) {
  const [participants, setParticipants] = useState<Participant[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);
  const [draftStatus, setDraftStatus] = useState<AttendanceStatus | null>(null);
  const [draftTime, setDraftTime] = useState("");

  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [onClose]);

  const load = useCallback(async () => {
    if (target.kind === "info") {
      setParticipants([]);
      return;
    }
    const supabase = createClient();

    const people =
      target.kind === "slot"
        ? await loadSlotParticipants(supabase, target.id)
        : await loadNumberParticipants(supabase, target.id);

    if (people.error) {
      setError(people.error);
      setParticipants([]);
      return;
    }

    const query = supabase.from("attendances").select("user_id, status, time_value");
    const { data, error: attendanceError } =
      target.kind === "slot"
        ? await query.in("slot_id", target.ids)
        : await query.eq("number_event_id", target.id);

    if (attendanceError) {
      setError(`出欠を取得できませんでした: ${attendanceError.message}`);
      setParticipants([]);
      return;
    }

    const rows: AttendanceRow[] = (
      (data ?? []) as { user_id: string; status: AttendanceStatus; time_value: string | null }[]
    ).map((row) => ({
      userId: row.user_id,
      status: row.status,
      timeValue: row.time_value ? row.time_value.slice(0, 5) : null,
    }));

    // まとめたコマを読むと、まとめる前に別々の部屋へ登録した人が二重に出る。
    // buildParticipants は1人1行を前提にしているのでここで潰す
    const unique = new Map<string, AttendanceRow>();
    for (const row of rows) {
      if (!unique.has(row.userId)) unique.set(row.userId, row);
    }

    setParticipants(buildParticipants(people.people, [...unique.values()]));
  }, [target]);

  useEffect(() => {
    load();
  }, [load]);

  const me = participants?.find((p) => p.userId === currentUserId) ?? null;
  const isParticipant = me !== null;

  async function save(status: AttendanceStatus, timeValue: string | null) {
    if (target.kind === "info") return;
    if (status === "absent" && !window.confirm(`${title} を欠席にしますか?`)) {
      return;
    }

    setPending(true);
    setError(null);
    const supabase = createClient();
    const key = target.kind === "slot" ? "slot_id" : "number_event_id";
    const { error: writeError } = await supabase.from("attendances").upsert(
      {
        user_id: currentUserId,
        [key]: target.id,
        status,
        time_value: timeValue,
      },
      { onConflict: `user_id,${key}` },
    );
    setPending(false);

    if (writeError) {
      setError(describeError(writeError));
      return;
    }

    // まとめた練習では、代表以外のコマに前の登録が残っていることがある。
    // 消しておかないと「欠席」を取り消しても片方が残り続ける
    if (target.kind === "slot" && target.ids.length > 1) {
      const others = target.ids.filter((id) => id !== target.id);
      await supabase
        .from("attendances")
        .delete()
        .eq("user_id", currentUserId)
        .in("slot_id", others);
    }

    setDraftStatus(null);
    setDraftTime("");
    load();
  }

  async function reset() {
    if (target.kind === "info") return;
    setPending(true);
    setError(null);
    const supabase = createClient();
    const remove = supabase
      .from("attendances")
      .delete()
      .eq("user_id", currentUserId);
    // まとめた練習は、どの部屋のコマに付いていても消す
    const { error: deleteError } =
      target.kind === "slot"
        ? await remove.in("slot_id", target.ids)
        : await remove.eq("number_event_id", target.id);
    setPending(false);

    if (deleteError) {
      setError(`取り消せませんでした: ${deleteError.message}`);
      return;
    }
    setDraftStatus(null);
    load();
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
          <h3 className="text-base font-bold">{title}</h3>
          <p className="text-xs text-[var(--muted)]">
            {formatDateLabel(date)} {formatTimeRange(startTime, endTime)}
            {location ? ` @${location}` : ""}
          </p>
        </div>

        {error ? (
          <p role="alert" className="rounded-lg bg-[#FDECEA] px-3 py-2 text-sm text-[#8B1A10]">
            {error}
          </p>
        ) : null}

        {target.kind === "info" ? (
          <p className="text-sm text-[var(--muted)]">
            この予定に出欠登録はありません
          </p>
        ) : participants === null ? (
          <p className="text-sm text-[var(--muted)]">読み込み中…</p>
        ) : (
          <>
            <section className="space-y-1">
              <h4 className="text-sm font-bold">
                参加者 ({participants.length}人)
              </h4>
              <ul className="max-h-56 divide-y divide-[var(--border)] overflow-y-auto rounded-xl border border-[var(--border)]">
                {participants.map((participant) => (
                  <li
                    key={participant.userId}
                    className="flex items-center gap-2 px-3 py-1.5 text-sm"
                  >
                    <span className="min-w-0 flex-1 truncate">
                      {participant.username}
                      {participant.userId === currentUserId ? (
                        <span className="ml-1 text-xs text-[var(--muted)]">
                          (自分)
                        </span>
                      ) : null}
                    </span>
                    <span
                      className={`shrink-0 rounded px-1.5 py-0.5 text-xs ${
                        participant.attendance
                          ? "bg-[#FDECEA] font-medium text-[#8B1A10]"
                          : "text-[var(--muted)]"
                      }`}
                    >
                      {formatAttendance(participant.attendance)}
                    </span>
                  </li>
                ))}
              </ul>
            </section>

            {isParticipant ? (
              <section className="space-y-2 border-t border-[var(--border)] pt-3">
                <h4 className="text-sm font-bold">
                  自分の出欠
                  <span className="ml-1 font-normal text-xs text-[var(--muted)]">
                    現在: {formatAttendance(me?.attendance ?? null)}
                  </span>
                </h4>
                <p className="text-xs text-[var(--muted)]">
                  出席なら操作は要りません。登録した内容はこの一覧に出ます
                </p>

                <div className="flex gap-2">
                  {(["absent", "late", "leave_early"] as AttendanceStatus[]).map(
                    (status) => (
                      <button
                        key={status}
                        type="button"
                        disabled={pending}
                        onClick={() => {
                          if (status === "absent") {
                            save("absent", null);
                            return;
                          }
                          // 時刻が要る状態は、その場で入力欄を開く
                          setDraftStatus(status);
                          setDraftTime(
                            me?.attendance?.status === status
                              ? (me.attendance.timeValue ?? "")
                              : "",
                          );
                        }}
                        aria-pressed={me?.attendance?.status === status}
                        className={`flex-1 rounded-lg border px-2 py-2 text-sm ${
                          me?.attendance?.status === status
                            ? "border-[var(--foreground)] bg-[var(--foreground)] font-bold text-white"
                            : "border-[var(--border)]"
                        }`}
                      >
                        {ATTENDANCE_LABELS[status]}
                      </button>
                    ),
                  )}
                </div>

                {draftStatus ? (
                  <div className="space-y-2 rounded-lg border border-[var(--border)] p-2">
                    <p className="text-xs font-medium">
                      {ATTENDANCE_TIME_LABELS[draftStatus]}時刻
                    </p>
                    {/* 1分刻みの自由入力 (SPEC §6.4.2 / v1.11)。
                        実際の到着・退出時刻は15分刻みに乗らないため、
                        プルダウンは置かない */}
                    <input
                      aria-label={`${ATTENDANCE_TIME_LABELS[draftStatus]}時刻`}
                      value={draftTime}
                      placeholder="15:20"
                      inputMode="numeric"
                      disabled={pending}
                      autoFocus
                      onChange={(e) =>
                        setDraftTime(normalizeTimeInput(e.target.value))
                      }
                      onBlur={(e) =>
                        setDraftTime(finalizeTimeInput(e.target.value))
                      }
                      className="w-full rounded-lg border border-[var(--border)] bg-[var(--background)] px-2 py-1.5 text-sm"
                    />
                    <p className="text-[10px] text-[var(--muted)]">
                      1分単位で入力できます。数字だけでも構いません (1520 → 15:20)
                    </p>
                    <button
                      type="button"
                      disabled={pending || !isValidAttendanceTime(draftTime)}
                      onClick={() => save(draftStatus, draftTime.trim())}
                      className={buttonClass}
                    >
                      {ATTENDANCE_LABELS[draftStatus]}で登録する
                    </button>
                  </div>
                ) : null}

                {me?.attendance ? (
                  <button
                    type="button"
                    disabled={pending}
                    onClick={reset}
                    className={secondaryButtonClass}
                  >
                    出席に戻す
                  </button>
                ) : null}
              </section>
            ) : (
              <p className="border-t border-[var(--border)] pt-3 text-xs text-[var(--muted)]">
                この練習の参加対象ではないため、出欠の登録はできません
              </p>
            )}
          </>
        )}

        <button type="button" onClick={onClose} className={secondaryButtonClass}>
          閉じる
        </button>
      </div>
    </div>
  );
}

function describeError(error: { code?: string; message: string }): string {
  if (error.code === "42501") {
    return "この練習の参加対象ではないため登録できません";
  }
  if (error.code === "23514") {
    return "遅刻・早退には時刻が必要です";
  }
  return `登録できませんでした: ${error.message}`;
}

type People = { people: { userId: string; username: string }[]; error?: string };

/**
 * 公式練の参加者 (SPEC §6.4.2):
 * そのジャンルを1〜3ジャンに持ち、対象期に該当する全メンバー。OB は除く。
 *
 * コマの genre_id / target_generations は呼び出し側に渡していないので
 * ここで引き直す。窓を開いたときだけの1回なので、
 * 全画面ぶんのデータを常に持ち回るより安い。
 */
async function loadSlotParticipants(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  supabase: any,
  slotId: string,
): Promise<People> {
  const { data: slot, error: slotError } = await supabase
    .from("slots")
    .select("genre_id, target_generations")
    .eq("id", slotId)
    .maybeSingle();

  if (slotError || !slot) {
    return { people: [], error: "練習の情報を取得できませんでした" };
  }
  const genreId = (slot as { genre_id: number | null }).genre_id;
  const generations = (slot as { target_generations: number[] | null })
    .target_generations;
  if (genreId === null) return { people: [] };

  // 2/3ジャンでそのジャンルを持つ人を先に集める。
  // profiles 側の or 条件に流し込むため
  const { data: subgenres } = await supabase
    .from("user_subgenres")
    .select("user_id")
    .eq("genre_id", genreId);
  const subIds = ((subgenres ?? []) as { user_id: string }[]).map(
    (row) => row.user_id,
  );

  const filter = subIds.length
    ? `main_genre_id.eq.${genreId},user_id.in.(${subIds.join(",")})`
    : `main_genre_id.eq.${genreId}`;

  const { data, error } = await supabase
    .from("profiles")
    .select("user_id, username, generation")
    .neq("role", "ob")
    .or(filter);

  if (error) {
    return { people: [], error: `参加者を取得できませんでした: ${error.message}` };
  }

  return {
    people: (
      (data ?? []) as { user_id: string; username: string; generation: number }[]
    )
      // 対象期の判定は JS 側で。配列の包含は件数が少なく、条件が読みやすい
      .filter((row) => generations === null || generations.includes(row.generation))
      .map((row) => ({ userId: row.user_id, username: row.username })),
  };
}

/** ナンバー練の参加者: そのナンバーのメンバー。非メンバーには RLS が0件を返す */
async function loadNumberParticipants(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  supabase: any,
  numberEventId: string,
): Promise<People> {
  const { data: event, error: eventError } = await supabase
    .from("number_events")
    .select("number_id")
    .eq("id", numberEventId)
    .maybeSingle();

  if (eventError || !event) {
    return { people: [], error: "予定の情報を取得できませんでした" };
  }

  const { data, error } = await supabase
    .from("number_members")
    .select("user_id, profiles(username)")
    .eq("number_id", (event as { number_id: string }).number_id);

  if (error) {
    return { people: [], error: `メンバーを取得できませんでした: ${error.message}` };
  }

  return {
    people: (
      (data ?? []) as { user_id: string; profiles: { username: string } | null }[]
    ).map((row) => ({
      userId: row.user_id,
      username: row.profiles?.username ?? "(不明)",
    })),
  };
}
