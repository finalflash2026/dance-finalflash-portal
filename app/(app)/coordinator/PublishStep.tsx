"use client";

import { useState } from "react";

import { ErrorMessage, buttonClass } from "@/components/ui";
import { ROOM_BY_ID } from "@/lib/constants";
import { SLOT_STATUS_LABELS } from "@/lib/slots";
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

  async function publish() {
    if (
      !window.confirm(
        `下書きのコマ ${drafts.length}件を公開し、OB以外の全員にお知らせを配ります。よろしいですか?`,
      )
    ) {
      return;
    }

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
        `${body.published}件を公開しました${
          body.notified ? ` / ${body.notified}人にお知らせを配りました` : ""
        }`,
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
          </p>

          {drafts.length === 0 ? (
            <p className="rounded-xl border border-[var(--border)] px-4 py-8 text-center text-sm text-[var(--muted)]">
              {slots.length === 0
                ? "この月のコマはありません。②コマ割り で作成してください"
                : "公開していないコマはありません"}
            </p>
          ) : (
            <>
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
                      @{ROOM_BY_ID.get(reservation.roomId)?.name}
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
                  {drafts.length}件を公開する
                </button>
              </div>
            </>
          )}
        </>
      )}
    </div>
  );
}
