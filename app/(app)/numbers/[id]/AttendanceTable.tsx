"use client";

import { useEffect, useMemo, useState } from "react";

import { ErrorMessage } from "@/components/ui";
import { ATTENDANCE_LABELS } from "@/lib/attendance";
import { dbErrorMessage } from "@/lib/error-message";
import { createClient } from "@/lib/supabase/client";
import { formatDateLabel, todayInTokyo } from "@/lib/time";
import type { AttendanceStatus } from "@/lib/types";

/**
 * ナンバーの出欠表 (SPEC.md §6.3 / v1.35)。
 *
 * 縦にメンバー・横に日程を並べ、交わるところに出欠を出す。コレオ・主催が
 * 「誰がいつ来られないか」を、日程を1つずつ開かずに1枚で見るため。
 * 行が無い人は出席 (§6.4.2) なので、マスは空けておく。
 * 見えるのはそのナンバーのメンバーだけ (RLS `sel_att`)。
 */

interface Row {
  user_id: string;
  number_event_id: string;
  status: AttendanceStatus;
  time_value: string | null;
  reason: string | null;
}

const SHORT: Record<AttendanceStatus, string> = { absent: "欠", late: "遅", leave_early: "早" };

export function AttendanceTable({
  events,
  members,
}: {
  events: { id: string; date: string; startTime: string }[];
  members: { userId: string; username: string }[];
}) {
  const today = todayInTokyo();
  const [rows, setRows] = useState<Row[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [showPast, setShowPast] = useState(false);
  /** 押したマス。理由などを表の下に出す */
  const [picked, setPicked] = useState<{ userId: string; eventId: string } | null>(null);

  const visible = useMemo(
    () =>
      [...events]
        .filter((e) => showPast || e.date >= today)
        .sort((a, b) => (a.date + a.startTime).localeCompare(b.date + b.startTime)),
    [events, showPast, today],
  );
  const pastCount = events.filter((e) => e.date < today).length;

  useEffect(() => {
    if (events.length === 0) {
      setRows([]);
      return;
    }
    let cancelled = false;
    createClient()
      .from("attendances")
      .select("user_id, number_event_id, status, time_value, reason")
      .in(
        "number_event_id",
        events.map((e) => e.id),
      )
      .then(({ data, error: fetchError }) => {
        if (cancelled) return;
        if (fetchError) {
          setError(dbErrorMessage("出欠を取得できませんでした", fetchError));
          setRows([]);
          return;
        }
        setRows((data ?? []) as Row[]);
      });
    return () => {
      cancelled = true;
    };
  }, [events]);

  const byCell = useMemo(
    () => new Map((rows ?? []).map((r) => [`${r.user_id}|${r.number_event_id}`, r])),
    [rows],
  );
  const pickedRow = picked ? byCell.get(`${picked.userId}|${picked.eventId}`) ?? null : null;
  const pickedMember = picked ? members.find((m) => m.userId === picked.userId) : null;
  const pickedEvent = picked ? events.find((e) => e.id === picked.eventId) : null;

  if (events.length === 0) {
    return <p className="text-sm text-[var(--muted)]">登録されている日程はありません</p>;
  }

  return (
    <section className="space-y-2">
      <ErrorMessage>{error}</ErrorMessage>
      {pastCount > 0 ? (
        <button
          type="button"
          onClick={() => setShowPast((v) => !v)}
          aria-pressed={showPast}
          className="h-9 rounded-full bg-[var(--fill)] px-3 text-[14px] text-[var(--tint)]"
        >
          {showPast ? "過去を隠す" : `過去も表示(${pastCount})`}
        </button>
      ) : null}

      {rows === null ? (
        <p className="text-sm text-[var(--muted)]">読み込み中…</p>
      ) : visible.length === 0 ? (
        <p className="text-sm text-[var(--muted)]">今後の日程はありません</p>
      ) : (
        // 横にスクロールし、名前の列は固定する
        <div className="h-scroll overflow-x-auto rounded-xl bg-[var(--cell)]">
          <table className="border-separate border-spacing-0 text-[13px]">
            <thead>
              <tr>
                <th className="sticky left-0 z-10 bg-[var(--cell)] px-3 py-2 text-left font-semibold">
                  メンバー
                </th>
                {visible.map((e) => (
                  <th key={e.id} className="min-w-[64px] px-1 py-2 text-center font-normal tabular-nums">
                    <span className="block font-semibold">{formatDateLabel(e.date)}</span>
                    <span className="block text-[11px] text-[var(--muted)]">{e.startTime}</span>
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {members.map((m) => (
                <tr key={m.userId}>
                  <th
                    scope="row"
                    className="sticky left-0 z-10 max-w-[140px] truncate border-t border-[var(--separator)] bg-[var(--cell)] px-3 py-1.5 text-left font-normal"
                  >
                    {m.username}
                  </th>
                  {visible.map((e) => {
                    const row = byCell.get(`${m.userId}|${e.id}`);
                    const on = picked?.userId === m.userId && picked.eventId === e.id;
                    return (
                      <td key={e.id} className="border-t border-[var(--separator)] p-0.5 text-center">
                        {row ? (
                          <button
                            type="button"
                            onClick={() => setPicked(on ? null : { userId: m.userId, eventId: e.id })}
                            aria-label={`${m.username} ${formatDateLabel(e.date)} ${ATTENDANCE_LABELS[row.status]}`}
                            className={`h-8 w-full rounded-md text-[12px] font-semibold tabular-nums ${
                              row.status === "absent"
                                ? "bg-[var(--danger-bg)] text-[var(--danger-fg)]"
                                : "bg-[var(--fill)]"
                            } ${on ? "ring-2 ring-[var(--tint)]" : ""}`}
                          >
                            {SHORT[row.status]}
                            {row.time_value ? ` ${row.time_value.slice(0, 5)}` : ""}
                          </button>
                        ) : (
                          <span className="sr-only">出席</span>
                        )}
                      </td>
                    );
                  })}
                </tr>
              ))}
              {/* 日程ごとの出られる人数 */}
              <tr>
                <th className="sticky left-0 z-10 border-t border-[var(--separator)] bg-[var(--cell)] px-3 py-2 text-left font-semibold">
                  出席
                </th>
                {visible.map((e) => {
                  const absent = members.filter(
                    (m) => byCell.get(`${m.userId}|${e.id}`)?.status === "absent",
                  ).length;
                  return (
                    <td key={e.id} className="border-t border-[var(--separator)] py-2 text-center font-semibold tabular-nums">
                      {members.length - absent}/{members.length}
                    </td>
                  );
                })}
              </tr>
            </tbody>
          </table>
        </div>
      )}

      {pickedRow && pickedMember && pickedEvent ? (
        <p className="rounded-xl bg-[var(--fill)] px-3 py-2 text-[14px]" aria-live="polite">
          {pickedMember.username}・{formatDateLabel(pickedEvent.date)}:{" "}
          {ATTENDANCE_LABELS[pickedRow.status]}
          {pickedRow.time_value ? ` ${pickedRow.time_value.slice(0, 5)}` : ""}
          {pickedRow.reason ? `(${pickedRow.reason})` : ""}
        </p>
      ) : null}
    </section>
  );
}
