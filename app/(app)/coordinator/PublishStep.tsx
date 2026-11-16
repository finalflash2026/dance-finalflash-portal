"use client";

import { useState } from "react";

import { ErrorMessage, buttonClass } from "@/components/ui";
import { confirmAction } from "@/lib/confirm";
import { useRoomById } from "@/lib/rooms";
import { SLOT_STATUS_LABELS, unassignedRanges } from "@/lib/slots";
import { formatDateLabel, formatTimeRange } from "@/lib/time";
import type { DateString } from "@/lib/types";

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
export function PublishStep({
  month,
  onPublished,
}: {
  month: DateString;
  /** 公開したあと (手順のボタンの数を読み直す) */
  onPublished?: () => void;
}) {
  const roomById = useRoomById();
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
        `あわせて、コマを割り当てていない時間帯 ${gaps.length}件を「空き」として公開します(個人練の申請ができるようになります)。`,
      );
    }
    lines.push("OB以外の全員にお知らせが配られます。よろしいですか?");
    if (!await confirmAction(lines.join("\n\n"))) return;

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
        setError(body.error ?? "公開に失敗しました。");
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
      onPublished?.();
    } finally {
      setPending(false);
    }
  }

  return (
    <div className="space-y-4">
      <ErrorMessage>{error}</ErrorMessage>
      {result ? (
        <p className="rounded-lg bg-[var(--surface)] px-3 py-2 text-sm">
          {result}
        </p>
      ) : null}

      {loading ? (
        <p className="rounded-2xl bg-[var(--cell)] px-4 py-8 text-center text-sm text-[var(--muted)]">
          読み込み中…
        </p>
      ) : (
        <>
          <div className="grid grid-cols-3 gap-2" aria-label="この月のコマ">
            {[
              { label: "下書き", value: drafts.length },
              { label: "空きで開く", value: gaps.length },
              { label: "公開済み", value: publishedCount },
            ].map((tile) => (
              <div key={tile.label} className="rounded-2xl bg-[var(--cell)] px-3 py-3">
                <span className="block text-[24px] font-bold leading-none tabular-nums">{tile.value}</span>
                <span className="mt-1 block text-[12px] text-[var(--muted)]">{tile.label}</span>
              </div>
            ))}
          </div>

          {total === 0 ? (
            <p className="rounded-2xl bg-[var(--cell)] px-4 py-8 text-center text-sm text-[var(--muted)]">
              {slots.length === 0 ? "この月のコマはありません" : "公開していないコマはありません"}
            </p>
          ) : (
            <>
              <ul className="divide-y divide-[var(--separator)] overflow-hidden rounded-2xl bg-[var(--cell)]">
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
                  現役全員にお知らせが届きます。
                  {gaps.length > 0 ? `割り振っていない ${gaps.length}件は空きとして個人練に開きます。` : ""}
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
