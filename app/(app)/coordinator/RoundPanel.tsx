"use client";

import { useCallback, useEffect, useState } from "react";

import { ErrorMessage, inputClass } from "@/components/ui";
import { confirmAction } from "@/lib/confirm";
import type { ScheduleRound } from "@/lib/scheduling/round";
import type { PlanInput } from "@/lib/scheduling/types";
import { showToast } from "@/lib/toast";
import { addDays, addMonths, daysBetween, formatDateLabel, parseDate, todayInTokyo } from "@/lib/time";
import type { DateString } from "@/lib/types";

import { DraftDoneContext, PlanPanel } from "../schedule/ScheduleClient";

/**
 * 折衝の ② 日程調整 と ③ 割り振りの上の「自動で割り振る」(SPEC.md §6.2 / v1.47)
 *
 * どちらも**表で選んでいる月**の予約枠と回答を使う。読み込みは画面の上 (CoordinatorClient) で
 * 1回だけ行い、手順のボタンの数にも使う。
 */

export interface MonthPlan {
  round: ScheduleRound | null;
  input: PlanInput | null;
  loading: boolean;
  error: string | null;
  reload: () => Promise<void>;
}

/** その月の日程調整の回と、割り振りの入力 (予約枠・名簿・回答) */
export function useMonthPlan(month: DateString, demo?: { round: ScheduleRound; input: PlanInput }): MonthPlan {
  const [round, setRound] = useState<ScheduleRound | null>(null);
  const [input, setInput] = useState<PlanInput | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const reload = useCallback(async () => {
    // 見本 (Supabase の無い環境) は決まった月だけ
    if (demo) {
      const hit = demo.round.month === month;
      setRound(hit ? demo.round : null);
      setInput(hit ? demo.input : null);
      setLoading(false);
      return;
    }
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
  }, [month, demo]);

  useEffect(() => {
    void reload();
  }, [reload]);

  return { round, input, loading, error, reload };
}

/** 受付中か (締め切っていない・締切の日を過ぎていない) */
export function isAccepting(round: ScheduleRound | null): boolean {
  return round?.status === "open" && todayInTokyo() <= round.deadline;
}

/** 締切の既定は前の月の15日。過ぎていれば1週間後。ただしその月の前日を越えない (v1.45) */
function defaultDeadline(month: DateString): DateString {
  const today = todayInTokyo();
  const lastDay = addDays(month, -1);
  const candidate = addDays(addMonths(month, -1), 14);
  const picked = candidate >= today ? candidate : addDays(today, 7);
  return picked > lastDay ? lastDay : picked;
}

/** ② 日程調整 */
export function RoundStep({
  month,
  plan,
  demo,
  onNext,
  onImport,
}: {
  month: DateString;
  plan: MonthPlan;
  demo: boolean;
  /** ③ 割り振りへ */
  onNext: () => void;
  /** ① 予約へ */
  onImport: () => void;
}) {
  const { round, input, loading } = plan;
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [deadline, setDeadline] = useState<string>(() => defaultDeadline(month));
  useEffect(() => setDeadline(defaultDeadline(month)), [month]);

  const monthLabel = `${parseDate(month).month}月`;
  const today = todayInTokyo();
  const lastDay = addDays(month, -1);
  const monthStarted = today >= month;
  const slots = input?.candidates.length ?? 0;
  const accepting = isAccepting(round);

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
    await plan.reload();
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
    await plan.reload();
  }

  if (loading) {
    return <div className="h-40 animate-pulse rounded-2xl bg-[var(--cell)]" aria-busy="true" />;
  }

  if (slots === 0) {
    return (
      <section className="space-y-3 rounded-2xl bg-[var(--cell)] px-4 py-8 text-center">
        <p className="text-[15px] text-[var(--muted)]">{monthLabel}の予約枠がありません</p>
        <button type="button" onClick={onImport} className="h-11 rounded-xl bg-[var(--fill)] px-5 text-[15px] font-semibold text-[var(--tint)]">
          予約を読み込む
        </button>
      </section>
    );
  }

  return (
    <div className="space-y-4">
      <ErrorMessage>{error ?? plan.error}</ErrorMessage>

      {round ? (
        <section className="space-y-4 rounded-2xl bg-[var(--cell)] p-5" aria-label={`${monthLabel}の日程調整`}>
          <div className="flex items-start justify-between gap-3">
            <div>
              <span
                className={`inline-block rounded-full px-2.5 py-0.5 text-[12px] font-semibold ${
                  accepting ? "bg-[var(--success-bg)] text-[var(--success-fg)]" : "bg-[var(--fill)] text-[var(--muted)]"
                }`}
              >
                {accepting ? "受付中" : "締切済み"}
              </span>
              <p className="mt-3 text-[13px] text-[var(--muted)]">回答</p>
              <p className="text-[34px] font-bold leading-none tabular-nums">
                {round.answeredCount}
                <span className="text-[17px] font-semibold text-[var(--muted)]"> / {round.memberCount}人</span>
              </p>
            </div>
            <div className="text-right">
              <p className="text-[13px] text-[var(--muted)]">締切</p>
              <p className="text-[17px] font-semibold tabular-nums">{formatDateLabel(round.deadline)}</p>
              {accepting ? (
                <p className="text-[13px] text-[var(--muted)] tabular-nums">
                  {(() => {
                    const days = daysBetween(today, round.deadline);
                    return days === 0 ? "今日" : `あと${days}日`;
                  })()}
                </p>
              ) : null}
            </div>
          </div>
          <div
            className="h-2.5 overflow-hidden rounded-full bg-[var(--fill)]"
            role="progressbar"
            aria-label="回答した人"
            aria-valuenow={round.answeredCount}
            aria-valuemax={round.memberCount}
          >
            <div
              className="h-full rounded-full bg-[var(--tint)] transition-[width] duration-300"
              style={{ width: `${round.memberCount ? (round.answeredCount / round.memberCount) * 100 : 0}%` }}
            />
          </div>
          {demo ? null : (
            <div className="flex flex-wrap gap-2">
              {accepting ? (
                <button
                  type="button"
                  onClick={() => void setStatus("closed")}
                  disabled={busy}
                  className="h-11 rounded-xl bg-[var(--fill)] px-4 text-[15px] font-semibold disabled:opacity-40"
                >
                  締め切る
                </button>
              ) : round.status === "closed" && today <= round.deadline ? (
                <button
                  type="button"
                  onClick={() => void setStatus("open")}
                  disabled={busy}
                  className="h-11 rounded-xl bg-[var(--fill)] px-4 text-[15px] font-semibold disabled:opacity-40"
                >
                  受付を戻す
                </button>
              ) : null}
            </div>
          )}
        </section>
      ) : monthStarted || demo ? (
        <section className="rounded-2xl bg-[var(--cell)] px-4 py-8 text-center text-[15px] text-[var(--muted)]">
          {monthLabel}の日程調整はありません
        </section>
      ) : (
        <section className="space-y-4 rounded-2xl bg-[var(--cell)] p-5">
          <h2 className="text-[17px] font-semibold">{monthLabel}の日程調整を始める</h2>
          <label className="block max-w-xs">
            <span className="mb-1 block text-[13px] text-[var(--muted)]">締切</span>
            <input
              type="date"
              value={deadline}
              min={today}
              max={lastDay}
              onChange={(e) => setDeadline(e.target.value)}
              className={inputClass}
            />
          </label>
          <p className="text-[13px] text-[var(--muted)]">現役全員にお知らせと通知が届きます。</p>
          <button
            type="button"
            onClick={() => void start()}
            disabled={busy || !deadline}
            className="h-12 rounded-xl bg-[var(--tint)] px-6 text-[16px] font-semibold text-white disabled:opacity-40"
          >
            {busy ? "始めています…" : "始める"}
          </button>
        </section>
      )}

      <button
        type="button"
        onClick={onNext}
        className="h-11 rounded-xl bg-[var(--fill)] px-5 text-[15px] font-semibold text-[var(--tint)]"
      >
        {round ? "割り振りへ" : "日程調整なしで割り振る"}
      </button>
    </div>
  );
}

/** ③ 割り振りの上の「自動で割り振る」。押すと案を作る欄が開く */
export function AutoAllocate({
  month,
  plan,
  initialOpen,
  onDrafted,
}: {
  month: DateString;
  plan: MonthPlan;
  initialOpen: boolean;
  onDrafted: () => void;
}) {
  const [open, setOpen] = useState(initialOpen);
  const { round, input, loading } = plan;
  const slots = input?.candidates.length ?? 0;
  if (loading || slots === 0 || !input) return null;

  // 日程調整をしていない月は名ばかりの回で開く (全員 ○ として計算。v1.45)
  const planRound: ScheduleRound = round ?? {
    id: "",
    month,
    deadline: addDays(month, -1),
    status: "closed",
    answeredCount: 0,
    memberCount: input.members.length,
    answeredByMe: false,
  };

  return (
    <section className="space-y-3" aria-label="自動の割り振り">
      <button
        type="button"
        aria-expanded={open}
        onClick={() => setOpen((v) => !v)}
        className="flex h-11 items-center gap-2 rounded-xl bg-[var(--tint)] px-5 text-[15px] font-semibold text-white transition-opacity active:opacity-80"
      >
        <svg viewBox="0 0 24 24" width="17" height="17" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
          <path d="M12 3l1.9 4.6L18.5 9l-4.6 1.9L12 15.5l-1.9-4.6L5.5 9l4.6-1.4z" />
          <path d="M19 15l.9 2.1L22 18l-2.1.9L19 21l-.9-2.1L16 18l2.1-.9z" />
        </svg>
        自動で割り振る
      </button>
      {open ? (
        <DraftDoneContext.Provider
          value={() => {
            setOpen(false);
            onDrafted();
          }}
        >
          <div className="max-w-3xl">
            <PlanPanel input={input} round={planRound} showStats={false} />
          </div>
        </DraftDoneContext.Provider>
      ) : null}
    </section>
  );
}
