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
 * コマ割りの表の上の「割り振り」の欄 (SPEC.md §6.2 / §6.8.5 / v1.44 / v1.45)
 *
 * **予約枠のある月なら、日程調整をしていなくても自動で割り振れる** (v1.45)。
 * 回答の無い人は全部 ○ と数える (計算する側で埋める。lib/scheduling/fill.ts)。
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
  // 締切の既定は前の月の15日。過ぎていれば1週間後。ただしその月の前日を越えない (v1.45)
  const today = todayInTokyo();
  const lastDay = addDays(month, -1);
  const monthStarted = today >= month;
  const defaultDeadline = (() => {
    const candidate = addDays(addMonths(month, -1), 14);
    const fallback = addDays(today, 7);
    const picked = candidate >= today ? candidate : fallback;
    return picked > lastDay ? lastDay : picked;
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

  // 日程調整をしていない月は、名ばかりの回で割り振りの欄を開く (締切は出さない)
  const planRound: ScheduleRound | null = round ?? (input
    ? {
        id: "",
        month,
        deadline: lastDay,
        status: "closed",
        answeredCount: 0,
        memberCount: input.members.length,
        answeredByMe: false,
      }
    : null);

  return (
    <section className="space-y-4 rounded-2xl bg-[var(--cell)] p-4" aria-label="割り振り">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="text-[17px] font-semibold">{monthLabel}の割り振り</h2>
          <p className="mt-0.5 text-[13px] text-[var(--muted)] tabular-nums">
            {loading
              ? "読み込んでいます…"
              : noSlots
                ? "予約枠がありません"
                : round
                  ? `日程調整 ${accepting ? "受付中" : "締切済み"}・回答 ${round.answeredCount}/${round.memberCount}人・締切 ${formatDateLabel(round.deadline)}`
                  : `予約したコマ ${input?.candidates.length ?? 0}・日程調整なし(全員 ○ で計算)`}
          </p>
        </div>
        <button
          type="button"
          aria-expanded={planOpen}
          onClick={() => setPlanOpen((open) => !open)}
          disabled={loading || noSlots}
          className="flex h-11 items-center gap-2 rounded-xl bg-[var(--tint)] px-5 text-[15px] font-semibold text-white transition-opacity active:opacity-80 disabled:opacity-40"
        >
          <svg viewBox="0 0 24 24" width="17" height="17" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
            <path d="M12 3l1.9 4.6L18.5 9l-4.6 1.9L12 15.5l-1.9-4.6L5.5 9l4.6-1.4z" />
            <path d="M19 15l.9 2.1L22 18l-2.1.9L19 21l-.9-2.1L16 18l2.1-.9z" />
          </svg>
          自動で割り振る
        </button>
      </div>

      {/* 日程調整 (始める・締め切る・戻す) */}
      {!loading && !noSlots ? (
        round ? (
          <div className="flex flex-wrap items-center gap-2">
            {accepting ? (
              <button
                type="button"
                onClick={() => void setStatus("closed")}
                disabled={busy}
                className="h-9 rounded-lg bg-[var(--fill)] px-3 text-[14px] font-semibold text-[var(--tint)] disabled:opacity-40"
              >
                日程調整を締め切る
              </button>
            ) : round.status === "closed" && !pastDeadline ? (
              <button
                type="button"
                onClick={() => void setStatus("open")}
                disabled={busy}
                className="h-9 rounded-lg bg-[var(--fill)] px-3 text-[14px] font-semibold text-[var(--tint)] disabled:opacity-40"
              >
                受付を戻す
              </button>
            ) : null}
          </div>
        ) : monthStarted ? null : (
          <details className="group rounded-xl bg-[var(--background)] px-3 py-2">
            <summary className="flex cursor-pointer list-none items-center justify-between text-[14px] font-semibold text-[var(--tint)] [&::-webkit-details-marker]:hidden">
              日程調整で出られる日を聞く
              <span aria-hidden className="transition-transform group-open:rotate-90">›</span>
            </summary>
            <div className="mt-3 flex flex-wrap items-end gap-2 pb-1">
              <label className="block">
                <span className="mb-1 block text-[13px] text-[var(--muted)]">締切</span>
                <input
                  type="date"
                  value={deadline}
                  min={today}
                  max={lastDay}
                  onChange={(e) => setDeadline(e.target.value)}
                  className={`${inputClass} w-44`}
                />
              </label>
              <button
                type="button"
                onClick={() => void start()}
                disabled={busy || !deadline}
                className="h-11 rounded-xl bg-[var(--fill)] px-4 text-[15px] font-semibold text-[var(--tint)] disabled:opacity-40"
              >
                {busy ? "始めています…" : "日程調整を始める"}
              </button>
            </div>
          </details>
        )
      ) : null}

      <ErrorMessage>{error}</ErrorMessage>

      {planOpen && planRound && input && !noSlots ? (
        <DraftDoneContext.Provider
          value={() => {
            setPlanOpen(false);
            onDrafted();
          }}
        >
          <div className="border-t border-[var(--separator)] pt-4">
            <PlanPanel input={input} round={planRound} />
          </div>
        </DraftDoneContext.Provider>
      ) : null}
    </section>
  );
}
