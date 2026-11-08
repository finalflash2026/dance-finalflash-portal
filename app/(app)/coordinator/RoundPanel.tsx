"use client";

import { useCallback, useEffect, useState } from "react";

import { ErrorMessage, inputClass } from "@/components/ui";
import { confirmAction } from "@/lib/confirm";
import type { ScheduleRound } from "@/lib/scheduling/round";
import type { PlanInput } from "@/lib/scheduling/types";
import { showToast } from "@/lib/toast";
import { addDays, addMonths, formatDateLabel, parseDate, todayInTokyo } from "@/lib/time";
import type { DateString } from "@/lib/types";

import { DraftDoneContext, PlanPanel } from "../schedule/ScheduleClient";

/**
 * コマ割りの表の上の「日程調整」の欄 (SPEC.md §6.2 / §6.8.5 / v1.44)
 *
 * **表で選んでいる月**の日程調整を扱う (月を勝手に切り替えない)。
 *   回が無い … 始める (締切を決める。現役全員にお知らせと通知)
 *   受付中   … 回答した人数・締切・締め切る
 *   締切済み … 受付を戻す
 *   回があれば「回答から案を作る」で割り振りの欄を開く
 * 開くたび・月を変えるたびにその月の予約枠と回答を読み直す。
 */
export function RoundPanel({
  month,
  initialPlanOpen,
  onDrafted,
}: {
  month: DateString;
  initialPlanOpen: boolean;
  onDrafted: () => void;
}) {
  const [round, setRound] = useState<ScheduleRound | null>(null);
  const [input, setInput] = useState<PlanInput | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [planOpen, setPlanOpen] = useState(initialPlanOpen);
  // 締切の既定はその月の前の月の15日 (過ぎていれば1週間後)
  const defaultDeadline = (() => {
    const candidate = addDays(addMonths(month, -1), 14);
    return candidate >= todayInTokyo() ? candidate : addDays(todayInTokyo(), 7);
  })();
  const [deadline, setDeadline] = useState<string>(defaultDeadline);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    const res = await fetch(`/api/schedule/input?month=${month}`, { cache: "no-store" }).catch(() => null);
    const body = await res?.json().catch(() => null);
    setLoading(false);
    if (!res?.ok) {
      setError(body?.error ?? "日程調整を読み込めませんでした。");
      return;
    }
    setRound(body.round);
    setInput(body.input);
  }, [month]);

  useEffect(() => {
    void load();
    setDeadline(defaultDeadline);
    // 月が変わったときだけ読み直す
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [month]);

  const monthLabel = `${parseDate(month).month}月`;

  async function start() {
    if (
      !(await confirmAction({
        message: `${monthLabel}の日程調整を始めます。締切は ${formatDateLabel(deadline as DateString)} です。現役全員にお知らせと通知が届きます。`,
        confirmLabel: "始める",
      }))
    ) {
      return;
    }
    setBusy(true);
    setError(null);
    const res = await fetch("/api/schedule/rounds", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ month, deadline }),
    }).catch(() => null);
    const body = await res?.json().catch(() => null);
    setBusy(false);
    if (!res?.ok) {
      setError(body?.error ?? "始められませんでした。");
      return;
    }
    showToast(`${monthLabel}の日程調整を始めました`);
    await load();
  }

  async function setStatus(status: "open" | "closed") {
    if (!round) return;
    setBusy(true);
    setError(null);
    const res = await fetch(`/api/schedule/rounds/${round.id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ status }),
    }).catch(() => null);
    const body = await res?.json().catch(() => null);
    setBusy(false);
    if (!res?.ok) {
      setError(body?.error ?? "変えられませんでした。");
      return;
    }
    showToast(status === "closed" ? "受付を締め切りました" : "受付を戻しました");
    await load();
  }

  const pastDeadline = round ? todayInTokyo() > round.deadline : false;
  const accepting = round?.status === "open" && !pastDeadline;
  const noSlots = input !== null && input.candidates.length === 0;

  return (
    <section className="max-w-3xl space-y-3 rounded-2xl bg-[var(--cell)] p-4" aria-label="日程調整">
      <div className="flex items-baseline justify-between gap-3">
        <h2 className="text-[17px] font-semibold">{monthLabel}の日程調整</h2>
        {round ? (
          <span
            className={`shrink-0 text-[13px] font-semibold ${
              accepting ? "text-[#34c759]" : "text-[var(--muted)]"
            }`}
          >
            {accepting ? "受付中" : "締切済み"}
          </span>
        ) : null}
      </div>

      {loading ? (
        <p className="text-[14px] text-[var(--muted)]">読み込んでいます…</p>
      ) : round ? (
        <>
          <div className="grid grid-cols-2 gap-2">
            <div className="rounded-xl bg-[var(--background)] px-3 py-2.5">
              <span className="block text-[12px] text-[var(--muted)]">回答した人</span>
              <span className="block text-[22px] font-bold tabular-nums">
                {round.answeredCount}
                <span className="text-[14px] font-semibold text-[var(--muted)]">/{round.memberCount}</span>
              </span>
            </div>
            <div className="rounded-xl bg-[var(--background)] px-3 py-2.5">
              <span className="block text-[12px] text-[var(--muted)]">締切</span>
              <span className="block text-[17px] font-bold tabular-nums">{formatDateLabel(round.deadline)}</span>
            </div>
          </div>
          <div className="flex flex-wrap gap-2">
            <button
              type="button"
              aria-expanded={planOpen}
              onClick={() => setPlanOpen((open) => !open)}
              disabled={noSlots}
              className="flex h-11 items-center gap-2 rounded-xl bg-[var(--tint)] px-4 text-[15px] font-semibold text-white active:opacity-80 disabled:opacity-40"
            >
              回答から案を作る
              <span aria-hidden className={`transition-transform ${planOpen ? "rotate-90" : ""}`}>›</span>
            </button>
            {accepting ? (
              <button
                type="button"
                onClick={() => void setStatus("closed")}
                disabled={busy}
                className="h-11 rounded-xl bg-[var(--fill)] px-4 text-[15px] font-semibold text-[var(--tint)] disabled:opacity-40"
              >
                締め切る
              </button>
            ) : round.status === "closed" ? (
              <button
                type="button"
                onClick={() => void setStatus("open")}
                disabled={busy || pastDeadline}
                className="h-11 rounded-xl bg-[var(--fill)] px-4 text-[15px] font-semibold text-[var(--tint)] disabled:opacity-40"
              >
                受付を戻す
              </button>
            ) : null}
          </div>
        </>
      ) : noSlots ? (
        <p className="text-[14px] text-[var(--muted)]">{monthLabel}の予約枠がありません</p>
      ) : (
        <div className="flex flex-wrap items-end gap-2">
          <label className="block">
            <span className="mb-1 block text-[13px] text-[var(--muted)]">締切</span>
            <input
              type="date"
              value={deadline}
              min={todayInTokyo()}
              onChange={(e) => setDeadline(e.target.value)}
              className={`${inputClass} w-44`}
            />
          </label>
          <button
            type="button"
            onClick={() => void start()}
            disabled={busy || !deadline}
            className="h-11 rounded-xl bg-[var(--tint)] px-4 text-[15px] font-semibold text-white active:opacity-80 disabled:opacity-40"
          >
            {busy ? "始めています…" : "日程調整を始める"}
          </button>
        </div>
      )}

      <ErrorMessage>{error}</ErrorMessage>

      {planOpen && round && input && !noSlots ? (
        <DraftDoneContext.Provider
          value={() => {
            setPlanOpen(false);
            onDrafted();
          }}
        >
          <div className="border-t border-[var(--separator)] pt-4">
            <PlanPanel input={input} round={round} />
          </div>
        </DraftDoneContext.Provider>
      ) : null}
    </section>
  );
}
