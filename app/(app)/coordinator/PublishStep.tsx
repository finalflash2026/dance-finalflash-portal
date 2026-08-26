"use client";

import { useState } from "react";

import { ErrorMessage, buttonClass } from "@/components/ui";
import { useRoomById } from "@/lib/rooms";
import { SLOT_STATUS_LABELS, unassignedRanges } from "@/lib/slots";
import { formatDateLabel, formatTimeRange, startOfMonth, todayInTokyo } from "@/lib/time";
import type { DateString } from "@/lib/types";

import { MonthNav } from "./MonthNav";
import { useMonthReservations } from "./useMonthReservations";

/**
 * Step3: 月一括公開 (SPEC.md §6.2 Step3)
 *
 * 公開そのものと全ユーザーへのお知らせは /api/slots/publish が行う。
 * ここは対象を見せて確認を取るだけ。
 *
 * 公開は**取り消せない操作ではない**が (Step2 で個別に戻せる)、
 * お知らせは配ってしまうと戻せないので、押す前に件数を必ず出す。
 */
export function PublishStep() {
  const roomById = useRoomById();
  const [month, setMonth] = useState<DateString>(() =>
    startOfMonth(todayInTokyo()),
  );
  const { reservations, loading, error, reload, setError } =
    useMonthReservations(month);
  const [pending, setPending] = useState(false);
  const [result, setResult] = useState<string | null>(null);

  const slots = reservations.flatMap((r) =>
    r.slots.map((slot) => ({ slot, reservation: r })),
  );
  const drafts = slots.filter(({ slot }) => !slot.published);
  const publishedCount = slots.length - drafts.length;

  // 公開時に自動生成される「空き」コマ (SPEC §6.2 Step3 / v1.9.2)。
  // API 側と同じ unassignedRanges() で数え、押す前に件数を見せる
  const gaps = reservations.flatMap((r) => unassignedRanges(r, r.slots));
  const total = drafts.length + gaps.length;

  async function publish() {
    const lines = [`${drafts.length}件の下書きコマを公開します。`];
    if (gaps.length > 0) {
      lines.push(
        `あわせて、コマを割り当てていない時間帯 ${gaps.length}件を「空き」として公開します (個人練の申請ができるようになります)。`,
      );
    }
    lines.push("OB以外の全員にお知らせが配られます。よろしいですか?");
    if (!window.confirm(lines.join("\n\n"))) return;

    setPending(true);
    setError(null);
    setResult(null);
    try {
      const res = await fetch("/api/slots/publish", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ month }),
      });
      const body = await res.json().catch(() => ({}));

      if (!res.ok && res.status !== 207) {
        setError(body.error ?? "公開に失敗しました");
        return;
      }
      // 207 = 公開は済んだがお知らせで失敗。両方伝える
      if (body.error) setError(body.error);
      setResult(
        `${body.published}件を公開しました` +
          (body.filled ? ` (うち自動生成の空き ${body.filled}件)` : "") +
          (body.notified ? ` / ${body.notified}人にお知らせを配りました` : ""),
      );
      reload();
    } finally {
      setPending(false);
    }
  }

  return (
    <div className="space-y-4">
      <MonthNav month={month} onChange={setMonth} disabled={pending} />
      <ErrorMessage>{error}</ErrorMessage>
      {result ? (
        <p className="rounded-lg bg-[var(--surface)] px-3 py-2 text-sm">
          {result}
        </p>
      ) : null}

      {loading ? (
        <p className="rounded-xl border border-[var(--border)] px-4 py-8 text-center text-sm text-[var(--muted)]">
          読み込み中…
        </p>
      ) : (
        <>
          <p className="text-sm text-[var(--muted)]">
            この月のコマ {slots.length}件 (下書き {drafts.length}件 / 公開済{" "}
            {publishedCount}件)
            {gaps.length > 0 ? ` / 未割当 ${gaps.length}件` : ""}
          </p>

          {total === 0 ? (
            <p className="rounded-xl border border-[var(--border)] px-4 py-8 text-center text-sm text-[var(--muted)]">
              {slots.length === 0
                ? "この月の予約枠がありません。①CSV取込 から登録してください"
                : "公開していないコマはありません"}
            </p>
          ) : (
            <>
              {gaps.length > 0 ? (
                <p className="rounded-lg bg-[var(--surface)] px-3 py-2 text-sm">
                  コマを割り当てていない時間帯 {gaps.length}件は、公開時に
                  <strong>「空き」として自動で開放</strong>されます
                  (予約している部屋を個人練に使えるようにするため)。
                  開放したくない時間帯は、②コマ割り で「使用不可」を置いて塞いでください。
                </p>
              ) : null}

              <ul className="divide-y divide-[var(--border)] rounded-xl border border-[var(--border)]">
                {drafts.map(({ slot, reservation }) => (
                  <li key={slot.id} className="px-3 py-2 text-sm">
                    <span className="tabular-nums text-[var(--muted)]">
                      {formatDateLabel(reservation.date)}{" "}
                      {formatTimeRange(slot.startTime, slot.endTime)}
                    </span>{" "}
                    <span className="font-medium">
                      {SLOT_STATUS_LABELS[slot.status]}
                    </span>{" "}
                    <span className="text-xs text-[var(--muted)]">
                      @{roomById.get(reservation.roomId)?.name}
                    </span>
                  </li>
                ))}
              </ul>

              <div className="space-y-2 border-t border-[var(--border)] pt-4">
                <p className="text-sm text-[var(--muted)]">
                  公開すると全体カレンダーに出て、空き申請ができるようになります。
                  あわせて OB 以外の全員にお知らせが配られます
                  {publishedCount > 0
                    ? " (この月は既に公開済のコマがあるため「更新されました」として届きます)"
                    : ""}
                  。
                </p>
                <button
                  type="button"
                  disabled={pending}
                  onClick={publish}
                  className={buttonClass}
                >
                  {total}件を公開する
                </button>
              </div>
            </>
          )}
        </>
      )}
    </div>
  );
}
