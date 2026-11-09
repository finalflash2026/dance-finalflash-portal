"use client";

import { useCallback, useEffect, useState } from "react";

import {
  ATTENDANCE_LABELS,
  ATTENDANCE_REASON_MAX,
  ATTENDANCE_REASON_PRESETS,
  ATTENDANCE_TIME_LABELS,
  buildParticipants,
  formatAttendance,
  isValidAttendanceTime,
  type AttendanceRow,
  type Participant,
} from "@/lib/attendance";
import { OFF_ROSTER_ROLES } from "@/lib/constants";
import { formatSpanRange } from "@/lib/day-span";
import { dbErrorMessage } from "@/lib/error-message";
import { useCanWrite } from "@/lib/role";
import { createClient } from "@/lib/supabase/client";
import {
  finalizeTimeInput,
  formatDateLabel,
  normalizeTimeInput,
} from "@/lib/time";
import { showToast } from "@/lib/toast";
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
  /** スタ練 (§6.3.1 / v1.24)。対象はそのジャンルを持つ現役全員 */
  | { kind: "studioPractice"; id: string; genreId: number }
  /** 空き申請など、出欠の対象にならないもの (SPEC §6.4.2) */
  | { kind: "info" };

export function AttendanceSheet({
  target,
  title,
  date,
  startTime,
  endTime,
  location,
  note,
  currentUserId,
  onClose,
}: {
  target: AttendanceTarget;
  title: string;
  date: DateString;
  startTime: string;
  endTime: string;
  location: string;
  /** メモ (持ち物・集合場所など。v1.32.5) */
  note?: string | null;
  currentUserId: string;
  onClose: () => void;
}) {
  const [participants, setParticipants] = useState<Participant[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);
  const [draftStatus, setDraftStatus] = useState<AttendanceStatus | null>(null);
  const [draftTime, setDraftTime] = useState("");
  /** 理由 (v1.33)。空のままでも登録できる */
  const [draftReason, setDraftReason] = useState("");

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
        ? await loadSlotParticipants(supabase, target.id, date)
        : target.kind === "studioPractice"
          ? await loadStudioParticipants(supabase, target.id, target.genreId, date)
          : await loadNumberParticipants(supabase, target.id);

    if (people.error) {
      setError(people.error);
      setParticipants([]);
      return;
    }

    const query = supabase.from("attendances").select("user_id, status, time_value, reason");
    const { data, error: attendanceError } =
      target.kind === "slot"
        ? await query.in("slot_id", target.ids)
        : target.kind === "studioPractice"
          ? await query.eq("genre_practice_id", target.id)
          : await query.eq("number_event_id", target.id);

    if (attendanceError) {
      setError(dbErrorMessage("出欠を取得できませんでした", attendanceError));
      setParticipants([]);
      return;
    }

    const rows: AttendanceRow[] = (
      (data ?? []) as {
        user_id: string;
        status: AttendanceStatus;
        time_value: string | null;
        reason: string | null;
      }[]
    ).map((row) => ({
      userId: row.user_id,
      status: row.status,
      timeValue: row.time_value ? row.time_value.slice(0, 5) : null,
      reason: row.reason,
    }));

    // まとめたコマを読むと、まとめる前に別々の部屋へ登録した人が二重に出る。
    // buildParticipants は1人1行を前提にしているのでここで潰す
    const unique = new Map<string, AttendanceRow>();
    for (const row of rows) {
      if (!unique.has(row.userId)) unique.set(row.userId, row);
    }

    setParticipants(buildParticipants(people.people, [...unique.values()]));
  }, [target, date]);

  useEffect(() => {
    load();
  }, [load]);

  const canWrite = useCanWrite();
  const me = participants?.find((p) => p.userId === currentUserId) ?? null;
  // 閲覧のみ (v1.30) は公式練・スタ練の参加者からは外れているが、
  // ナンバーには所属が残ることがある。見えていても答えさせない
  const isParticipant = me !== null && canWrite;

  /** 状態のボタンを押したら、その場で時刻 (遅刻・早退) と理由の欄を開く */
  function startDraft(status: AttendanceStatus) {
    const current = me?.attendance?.status === status ? me.attendance : null;
    setDraftStatus(status);
    setDraftTime(current?.timeValue ?? "");
    setDraftReason(current?.reason ?? "");
  }

  /**
   * 欠席も「欠席で登録する」を押して決める (v1.33)。以前は押した瞬間に
   * 確認の窓を出していたが、理由の欄を挟んだので押し間違いはここで止まる
   */
  async function save(status: AttendanceStatus, timeValue: string | null, reason: string) {
    if (target.kind === "info") return;

    setPending(true);
    setError(null);
    const supabase = createClient();
    const key =
      target.kind === "slot"
        ? "slot_id"
        : target.kind === "studioPractice"
          ? "genre_practice_id"
          : "number_event_id";
    const { error: writeError } = await supabase.from("attendances").upsert(
      {
        user_id: currentUserId,
        [key]: target.id,
        status,
        time_value: timeValue,
        reason: reason.trim() || null,
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
    setDraftReason("");
    showToast(`${ATTENDANCE_LABELS[status]}で登録しました`);
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
        : target.kind === "studioPractice"
          ? await remove.eq("genre_practice_id", target.id)
          : await remove.eq("number_event_id", target.id);
    setPending(false);

    if (deleteError) {
      setError(dbErrorMessage("取り消せませんでした", deleteError));
      return;
    }
    setDraftStatus(null);
    load();
  }

  // 人数の帯 (v1.45)。状態ごとの人数と、押したら絞り込む
  const [filter, setFilter] = useState<Bucket | null>(null);
  const counts = countBuckets(participants ?? []);
  const shown = sortForList(participants ?? [], currentUserId).filter(
    (p) => filter === null || bucketOf(p) === filter,
  );
  const current = draftStatus ?? me?.attendance?.status ?? null;

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
        aria-labelledby="attendance-title"
        className="sheet-in safe-bottom relative z-10 flex max-h-[90dvh] w-full max-w-md flex-col rounded-t-[22px] bg-[var(--background)] sm:rounded-[22px]"
      >
        <span aria-hidden className="mx-auto mt-2 h-1 w-9 shrink-0 rounded-full bg-[var(--border)] sm:hidden" />

        {/* ① 予定 */}
        <header className="flex shrink-0 items-start gap-3 px-5 pb-3 pt-3">
          <div className="min-w-0 flex-1">
            <h2 id="attendance-title" className="text-[20px] font-bold leading-tight">
              {title}
            </h2>
            <p className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-0.5 text-[14px] text-[var(--muted)] tabular-nums">
              <span className="inline-flex items-center gap-1">
                <Icon d="M12 7v5l3 2M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18z" />
                {formatDateLabel(date)} {formatSpanRange(startTime, endTime)}
              </span>
              {location ? (
                <span className="inline-flex min-w-0 items-center gap-1">
                  <Icon d="M12 21s-7-6.2-7-11a7 7 0 0 1 14 0c0 4.8-7 11-7 11zM12 12.5a2.5 2.5 0 1 0 0-5 2.5 2.5 0 0 0 0 5z" />
                  <span className="truncate">{location}</span>
                </span>
              ) : null}
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="閉じる"
            className="glass glass-press grid h-8 w-8 shrink-0 place-items-center rounded-full text-[var(--muted)]"
          >
            <svg viewBox="0 0 24 24" width="13" height="13" aria-hidden>
              <path d="M6 6l12 12M18 6L6 18" stroke="currentColor" strokeWidth="2.6" strokeLinecap="round" />
            </svg>
          </button>
        </header>

        <div className="min-h-0 flex-1 space-y-5 overflow-y-auto px-5 pb-5">
          {note?.trim() ? (
            <p className="whitespace-pre-wrap break-words rounded-xl bg-[var(--fill)] px-3 py-2 text-[14px]">
              {note.trim()}
            </p>
          ) : null}

          {error ? (
            <p role="alert" className="rounded-xl bg-[var(--danger-bg)] px-3 py-2 text-sm text-[var(--danger-fg)]">
              {error}
            </p>
          ) : null}

          {target.kind === "info" ? (
            <p className="text-sm text-[var(--muted)]">この予定に出欠登録はありません</p>
          ) : participants === null ? (
            <div className="space-y-3" aria-busy="true">
              <div className="h-3 animate-pulse rounded-full bg-[var(--fill)]" />
              <div className="h-24 animate-pulse rounded-2xl bg-[var(--fill)]" />
            </div>
          ) : (
            <>
              {/* ② 人数の帯 */}
              <section aria-label="出欠の人数" className="space-y-2.5">
                <div className="flex h-2.5 overflow-hidden rounded-full bg-[var(--fill)]">
                  {BUCKETS.map((bucket) =>
                    counts[bucket.id] > 0 ? (
                      <span
                        key={bucket.id}
                        className="h-full transition-[flex-grow] duration-300"
                        style={{ flexGrow: counts[bucket.id], backgroundColor: bucket.color }}
                      />
                    ) : null,
                  )}
                </div>
                <div className="grid grid-cols-4 gap-1.5">
                  {BUCKETS.map((bucket) => {
                    const on = filter === bucket.id;
                    return (
                      <button
                        key={bucket.id}
                        type="button"
                        aria-pressed={on}
                        onClick={() => setFilter(on ? null : bucket.id)}
                        className={`rounded-xl px-2 py-2 text-left transition-[background-color,box-shadow] ${
                          on ? "bg-[var(--cell)] shadow-[0_0_0_2px_var(--tint)]" : "bg-[var(--cell)]"
                        }`}
                      >
                        <span className="flex items-center gap-1 text-[12px] text-[var(--muted)]">
                          <span aria-hidden className="h-2 w-2 rounded-full" style={{ backgroundColor: bucket.color }} />
                          {bucket.label}
                        </span>
                        <span className="block text-[22px] font-bold leading-tight tabular-nums">
                          {counts[bucket.id]}
                        </span>
                      </button>
                    );
                  })}
                </div>
              </section>

              {/* ③ 自分の出欠 */}
              {isParticipant ? (
                <section aria-label="自分の出欠" className="space-y-2.5">
                  <h3 className="text-[15px] font-semibold">自分の出欠</h3>
                  <div className="grid grid-cols-4 gap-2">
                    {(["present", "late", "leave_early", "absent"] as AttendanceStatus[]).map((status) => {
                      const on = current === status;
                      const look = STATUS_LOOK[status];
                      return (
                        <button
                          key={status}
                          type="button"
                          disabled={pending}
                          // 出席は押すだけで決まる (理由・時刻は要らない。v1.36)
                          onClick={() =>
                            status === "present" ? save("present", null, "") : startDraft(status)
                          }
                          aria-pressed={on}
                          className="flex h-[72px] flex-col items-center justify-center gap-1 rounded-2xl text-[13px] font-semibold transition-[background-color,color,transform] active:scale-[0.96] disabled:opacity-50"
                          style={{
                            backgroundColor: on ? look.color : "var(--cell)",
                            color: on ? "#fff" : "var(--foreground)",
                          }}
                        >
                          <span
                            aria-hidden
                            className="grid h-7 w-7 place-items-center rounded-full text-[15px] font-bold"
                            style={{
                              backgroundColor: on ? "rgba(255,255,255,0.25)" : look.soft,
                              color: on ? "#fff" : look.color,
                            }}
                          >
                            {look.mark}
                          </span>
                          {ATTENDANCE_LABELS[status]}
                        </button>
                      );
                    })}
                  </div>
                  {me?.attendance && !draftStatus ? (
                    <p className="text-[13px] text-[var(--muted)]">
                      {formatAttendance(me.attendance)}
                      {me.attendance.reason ? `・${me.attendance.reason}` : ""} で登録済み
                    </p>
                  ) : null}

                  {draftStatus ? (
                    <div className="space-y-3 rounded-2xl bg-[var(--cell)] p-3">
                      {draftStatus !== "absent" ? (
                        <label className="block">
                          <span className="mb-1 block text-[13px] font-medium">
                            {ATTENDANCE_TIME_LABELS[draftStatus]}時刻
                          </span>
                          {/* 1分刻みの自由入力 (SPEC §6.4.2 / v1.11) */}
                          <input
                            aria-label={`${ATTENDANCE_TIME_LABELS[draftStatus]}時刻`}
                            value={draftTime}
                            placeholder="1520"
                            inputMode="numeric"
                            disabled={pending}
                            autoFocus
                            onChange={(e) => setDraftTime(normalizeTimeInput(e.target.value))}
                            onBlur={(e) => setDraftTime(finalizeTimeInput(e.target.value))}
                            className="h-11 w-full rounded-xl bg-[var(--background)] px-3 text-[17px] tabular-nums outline-none ring-1 ring-[var(--separator)] focus:ring-2 focus:ring-[var(--tint)]"
                          />
                        </label>
                      ) : null}

                      {/* 理由 (v1.33)。よくあるものは押すだけで入る。もう一度押すと外れる */}
                      <div className="flex flex-wrap gap-1.5">
                        {ATTENDANCE_REASON_PRESETS.map((preset) => (
                          <button
                            key={preset}
                            type="button"
                            disabled={pending}
                            aria-pressed={draftReason === preset}
                            onClick={() => setDraftReason((prev) => (prev === preset ? "" : preset))}
                            className={`h-9 rounded-full px-3 text-[14px] transition-colors ${
                              draftReason === preset
                                ? "bg-[var(--primary)] font-semibold text-[var(--primary-fg)]"
                                : "bg-[var(--background)]"
                            }`}
                          >
                            {preset}
                          </button>
                        ))}
                      </div>
                      <input
                        aria-label="理由"
                        value={draftReason}
                        placeholder="理由(任意)"
                        maxLength={ATTENDANCE_REASON_MAX}
                        disabled={pending}
                        onChange={(e) => setDraftReason(e.target.value)}
                        className="h-11 w-full rounded-xl bg-[var(--background)] px-3 text-[16px] outline-none ring-1 ring-[var(--separator)] focus:ring-2 focus:ring-[var(--tint)]"
                      />

                      <div className="flex gap-2">
                        <button
                          type="button"
                          onClick={() => setDraftStatus(null)}
                          disabled={pending}
                          className="h-12 flex-1 rounded-xl bg-[var(--background)] text-[16px] font-semibold"
                        >
                          やめる
                        </button>
                        <button
                          type="button"
                          disabled={pending || (draftStatus !== "absent" && !isValidAttendanceTime(draftTime))}
                          onClick={() =>
                            save(draftStatus, draftStatus === "absent" ? null : draftTime.trim(), draftReason)
                          }
                          className="h-12 flex-[2] rounded-xl text-[16px] font-semibold text-white disabled:opacity-40"
                          style={{ backgroundColor: STATUS_LOOK[draftStatus].color }}
                        >
                          {ATTENDANCE_LABELS[draftStatus]}で登録する
                        </button>
                      </div>
                    </div>
                  ) : null}

                  {me?.attendance && !draftStatus ? (
                    <button
                      type="button"
                      disabled={pending}
                      onClick={reset}
                      className="text-[14px] text-[var(--danger-fg)] disabled:opacity-40"
                    >
                      回答を取り消す
                    </button>
                  ) : null}
                </section>
              ) : canWrite ? (
                <p className="rounded-xl bg-[var(--cell)] px-3 py-2.5 text-[13px] text-[var(--muted)]">
                  この練習の参加対象ではないため、出欠は付けられません。
                </p>
              ) : null}

              {/* ④ 参加者 */}
              <section aria-label="参加者" className="space-y-2">
                <h3 className="flex items-baseline gap-2 text-[15px] font-semibold">
                  参加者
                  <span className="text-[13px] font-normal text-[var(--muted)] tabular-nums">
                    {filter ? `${shown.length} / ${participants.length}人` : `${participants.length}人`}
                  </span>
                </h3>
                {shown.length === 0 ? (
                  <p className="py-4 text-center text-[14px] text-[var(--muted)]">該当する人はいません</p>
                ) : (
                  <ul className="divide-y divide-[var(--separator)] overflow-hidden rounded-2xl bg-[var(--cell)]">
                    {shown.map((participant) => {
                      const bucket = BUCKET_BY_ID[bucketOf(participant)];
                      const mine = participant.userId === currentUserId;
                      return (
                        <li key={participant.userId} className="flex items-center gap-3 px-3 py-2">
                          <span
                            aria-hidden
                            className="grid h-8 w-8 shrink-0 place-items-center rounded-full text-[13px] font-bold"
                            style={{ backgroundColor: bucket.soft, color: bucket.color }}
                          >
                            {initialOf(participant.username)}
                          </span>
                          <span className="min-w-0 flex-1">
                            <span className="block truncate text-[15px]">
                              {participant.username}
                              {mine ? <span className="ml-1 text-[12px] text-[var(--muted)]">(自分)</span> : null}
                            </span>
                            {participant.attendance?.reason ? (
                              <span className="block truncate text-[12px] text-[var(--muted)]">
                                {participant.attendance.reason}
                              </span>
                            ) : null}
                          </span>
                          <span
                            className="shrink-0 rounded-full px-2.5 py-1 text-[12px] font-semibold tabular-nums"
                            style={{ backgroundColor: bucket.soft, color: bucket.color }}
                          >
                            {formatAttendance(participant.attendance)}
                          </span>
                        </li>
                      );
                    })}
                  </ul>
                )}
              </section>
            </>
          )}
        </div>
      </div>
    </div>
  );
}

/** 小さな線のアイコン */
function Icon({ d }: { d: string }) {
  return (
    <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden className="shrink-0">
      <path d={d} />
    </svg>
  );
}

// ---------- 状態の見た目 (v1.45) ----------

type Bucket = "present" | "partial" | "absent" | "none";

/** 人数の帯と参加者の色。遅刻と早退は「一部だけ出る」としてまとめる */
const BUCKETS: { id: Bucket; label: string; color: string; soft: string }[] = [
  { id: "present", label: "出席", color: "#34c759", soft: "rgba(52,199,89,0.16)" },
  { id: "partial", label: "遅刻・早退", color: "#ff9f0a", soft: "rgba(255,159,10,0.18)" },
  { id: "absent", label: "欠席", color: "#ff3b30", soft: "rgba(255,59,48,0.14)" },
  { id: "none", label: "未回答", color: "#8e8e93", soft: "rgba(142,142,147,0.18)" },
];
const BUCKET_BY_ID = Object.fromEntries(BUCKETS.map((b) => [b.id, b])) as Record<Bucket, (typeof BUCKETS)[number]>;

const STATUS_LOOK: Record<AttendanceStatus, { color: string; soft: string; mark: string }> = {
  present: { color: "#34c759", soft: "rgba(52,199,89,0.16)", mark: "✓" },
  late: { color: "#ff9f0a", soft: "rgba(255,159,10,0.18)", mark: "↘" },
  leave_early: { color: "#ff9f0a", soft: "rgba(255,159,10,0.18)", mark: "↗" },
  absent: { color: "#ff3b30", soft: "rgba(255,59,48,0.14)", mark: "×" },
};

function bucketOf(participant: Participant): Bucket {
  const status = participant.attendance?.status;
  if (!status) return "none";
  if (status === "present") return "present";
  if (status === "absent") return "absent";
  return "partial";
}

function countBuckets(list: Participant[]): Record<Bucket, number> {
  const counts: Record<Bucket, number> = { present: 0, partial: 0, absent: 0, none: 0 };
  for (const p of list) counts[bucketOf(p)] += 1;
  return counts;
}

/** 自分を一番上に、あとは 出席 → 遅刻・早退 → 欠席 → 未回答 の順 */
function sortForList(list: Participant[], me: string): Participant[] {
  const order: Bucket[] = ["present", "partial", "absent", "none"];
  return [...list].sort((a, b) => {
    if (a.userId === me) return -1;
    if (b.userId === me) return 1;
    return order.indexOf(bucketOf(a)) - order.indexOf(bucketOf(b));
  });
}

/** 名前の頭文字の丸に出す1文字 (期とジャンルの後ろの名前から) */
function initialOf(username: string): string {
  const name = username.replace(/^\d+[A-Z]+/, "");
  return (name || username).slice(0, 1);
}

function describeError(error: { code?: string; message: string }): string {
  if (error.code === "42501") {
    return "この練習の参加対象ではないため登録できません。";
  }
  if (error.code === "23514") {
    return "遅刻・早退には時刻が必要です。";
  }
  return dbErrorMessage("登録できませんでした", error);
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
  date: DateString,
): Promise<People> {
  const { data: slot, error: slotError } = await supabase
    .from("slots")
    .select("genre_id, target_generations")
    .eq("id", slotId)
    .maybeSingle();

  if (slotError || !slot) {
    return { people: [], error: "練習の情報を取得できませんでした。" };
  }
  const genreId = (slot as { genre_id: number | null }).genre_id;
  const generations = (slot as { target_generations: number[] | null })
    .target_generations;
  if (genreId === null) return { people: [] };

  return loadGenreParticipants(supabase, genreId, generations, date);
}

/**
 * スタ練の参加者 (SPEC §6.3.1 / v1.25)
 *
 * ジャンルと**対象期**の両方で絞る。公式練とまったく同じ条件で、
 * 違いは「どこから期を引くか」だけ。
 */
async function loadStudioParticipants(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  supabase: any,
  practiceId: string,
  genreId: number,
  date: DateString,
): Promise<People> {
  const { data, error } = await supabase
    .from("genre_practices")
    .select("target_generations")
    .eq("id", practiceId)
    .maybeSingle();

  if (error || !data) {
    return { people: [], error: "スタ練の情報を取得できませんでした。" };
  }
  return loadGenreParticipants(
    supabase,
    genreId,
    (data as { target_generations: number[] | null }).target_generations,
    date,
  );
}

/**
 * そのジャンルを1〜3ジャンに持つ現役 (SPEC §6.4.2)。
 *
 * 公式練とスタ練で共用する。どちらも対象期を持ち (v1.25)、
 * `null` なら期を問わない。**条件を2か所に持たない**ため関数を1つにしてある。
 */
async function loadGenreParticipants(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  supabase: any,
  genreId: number,
  generations: number[] | null,
  date: DateString,
): Promise<People> {
  // 2/3ジャンでそのジャンルを持つ人を先に集める。
  // profiles 側の or 条件に流し込むため。
  // **練習の日のサブジャンルで見る** (v1.32.5)。カレンダー (v1.31.9) と
  // 出欠の書き込み条件 (mod_att, 0023) と同じ判定にする
  const { data: subgenres } = await supabase
    .from("user_subgenre_periods")
    .select("user_id")
    .eq("genre_id", genreId)
    .lte("from_date", date)
    .or(`to_date.is.null,to_date.gte.${date}`);
  const subIds = ((subgenres ?? []) as { user_id: string }[]).map(
    (row) => row.user_id,
  );

  const filter = subIds.length
    ? `main_genre_id.eq.${genreId},user_id.in.(${subIds.join(",")})`
    : `main_genre_id.eq.${genreId}`;

  // 現役だけ。閲覧のみ (v1.30) はジャンルを持っていても参加者に出さない
  const { data, error } = await supabase
    .from("profiles")
    .select("user_id, username, generation")
    .not("role", "in", OFF_ROSTER_ROLES)
    .or(filter);

  if (error) {
    return { people: [], error: dbErrorMessage("参加者を取得できませんでした", error) };
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
    return { people: [], error: "予定の情報を取得できませんでした。" };
  }

  const { data, error } = await supabase
    .from("number_members")
    .select("user_id, profiles(username)")
    .eq("number_id", (event as { number_id: string }).number_id);

  if (error) {
    return { people: [], error: dbErrorMessage("メンバーを取得できませんでした", error) };
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
