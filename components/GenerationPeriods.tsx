"use client";

import { useCallback, useEffect, useMemo, useState } from "react";

import { Sheet } from "@/components/Sheet";
import {
  ErrorMessage,
  GroupFooter,
  GroupHeader,
  cellInputClass,
  destructiveButtonClass,
  groupClass,
  primaryButtonClass,
  tintTextClass,
} from "@/components/ui";
import { confirmAction } from "@/lib/confirm";
import { OFF_ROSTER_ROLES } from "@/lib/constants";
import { dbErrorMessage } from "@/lib/error-message";
import {
  GENERATION_PERIOD_COLUMNS,
  PERIOD_NAME_MAX,
  affectedRange,
  applyPeriod,
  changedSlots,
  describeOtherChanges,
  formatGenerations,
  formatPeriodRange,
  fromRow,
  normalizeGenerations,
  periodsOverlapping,
  removePeriod,
  validatePeriodDraft,
  type GenerationPeriod,
  type GenerationPeriodRow,
  type PeriodDraft,
} from "@/lib/generation-periods";
import { isMissingRelation } from "@/lib/schema-errors";
import { createClient } from "@/lib/supabase/client";
import { selectAll } from "@/lib/supabase/select-all";
import { endOfMonth, startOfMonth, todayInTokyo } from "@/lib/time";
import { showToast } from "@/lib/toast";
import type { DateString } from "@/lib/types";

/**
 * 公式練の対象期の期間 (SPEC.md §6.2 Step3 / §6.7.11 / v1.51)
 *
 * 折衝の ④ 公開 (その月にかかる期間) と、管理画面の「対象期」(3役・月を選ばない) で使う。
 * 保存・削除は `/api/generation-periods` を通す。公開済みの公式練の対象期が変わる
 * 保存は3役だけ (DB の関数で止める)。画面でも先に数えて、折衝には押せなくする。
 */

/**
 * 期間の一覧を読む。`available` が false なら DB に表が無い (0030 が未適用。§13.5)。
 * 読み込み中は null。
 */
export function useGenerationPeriods() {
  const [periods, setPeriods] = useState<GenerationPeriod[]>([]);
  const [available, setAvailable] = useState<boolean | null>(null);
  const [error, setError] = useState<string | null>(null);

  const reload = useCallback(async () => {
    try {
      const { data, error: loadError } = await createClient()
        .from("generation_periods")
        .select(GENERATION_PERIOD_COLUMNS)
        .order("start_date", { ascending: true });
      if (isMissingRelation(loadError)) {
        setAvailable(false);
        setPeriods([]);
        return;
      }
      setAvailable(true);
      if (loadError) {
        setError(dbErrorMessage("対象期の期間を読めませんでした", loadError));
        return;
      }
      setError(null);
      setPeriods(((data ?? []) as GenerationPeriodRow[]).map(fromRow));
    } catch {
      // 通信そのものが失敗したとき。「読み込み中」のまま止めない
      setAvailable(true);
      setError("対象期の期間を読めませんでした。通信を確かめてください。");
    }
  }, []);

  useEffect(() => {
    void reload();
  }, [reload]);

  return { periods, available, error, reload };
}

/** ③ 割り振りで見るだけの一覧 (書き換えは ④ 公開と管理画面) */
export function PeriodSummary({
  periods,
  month,
}: {
  periods: GenerationPeriod[];
  month: DateString;
}) {
  const list = periodsOverlapping(periods, startOfMonth(month), endOfMonth(month));
  return (
    <section className="space-y-2 rounded-2xl bg-[var(--cell)] p-4">
      <h3 className="text-sm font-bold">対象期</h3>
      {list.length === 0 ? (
        <p className="text-xs text-[var(--muted)]">この月はすべて全期</p>
      ) : (
        <ul className="space-y-1 text-sm">
          {list.map((p) => (
            <li key={p.id} className="flex flex-wrap items-baseline gap-x-2">
              <span className="tabular-nums">{formatPeriodRange(p.startDate, p.endDate)}</span>
              <span className="font-semibold">{formatGenerations(p.generations)}</span>
              {p.name ? <span className="text-xs text-[var(--muted)]">{p.name}</span> : null}
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

/**
 * 期間の一覧と「追加」。押すと編集の窓が開く。
 * `month` を渡すとその月にかかる期間だけ、渡さなければ `since` から先を並べる。
 */
export function GenerationPeriodsSection({
  isAdmin,
  month,
  since,
}: {
  isAdmin: boolean;
  month?: DateString;
  since?: DateString;
}) {
  const { periods, available, error, reload } = useGenerationPeriods();
  const [draft, setDraft] = useState<PeriodDraft | null>(null);

  // 表が無い DB (0030 の前) では出さない。読み込み中も出さない — 前の DB で欄が一瞬見えてしまうため
  if (available !== true) return null;

  const visible = month
    ? periodsOverlapping(periods, startOfMonth(month), endOfMonth(month))
    : periods.filter((p) => !since || p.endDate >= since);

  function create() {
    const today = todayInTokyo();
    const start = month ? startOfMonth(month) : today;
    setDraft({
      id: null,
      updatedAt: null,
      name: "",
      startDate: start,
      endDate: month ? endOfMonth(month) : endOfMonth(today),
      generations: [],
    });
  }

  return (
    <section>
      <div className="flex items-end justify-between px-4 pb-1.5">
        <GroupHeader>対象期</GroupHeader>
        <button type="button" onClick={create} className={tintTextClass}>
          追加
        </button>
      </div>
      <ErrorMessage>{error}</ErrorMessage>
      {visible.length === 0 ? (
        <p className={`${groupClass} px-4 py-3 text-[15px] text-[var(--muted)]`}>
          {month ? "この月はすべて全期" : "まだありません"}
        </p>
      ) : (
        <>
          <ul className={groupClass}>
            {visible.map((p) => (
              <li key={p.id}>
                <button
                  type="button"
                  onClick={() =>
                    setDraft({
                      id: p.id,
                      updatedAt: p.updatedAt,
                      name: p.name ?? "",
                      startDate: p.startDate,
                      endDate: p.endDate,
                      generations: p.generations ?? [],
                    })
                  }
                  className="flex w-full items-center gap-3 px-4 py-3 text-left"
                >
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-[17px]">
                      {p.name ?? formatPeriodRange(p.startDate, p.endDate)}
                    </span>
                    <span className="block truncate text-[13px] text-[var(--muted)] tabular-nums">
                      {p.name ? `${formatPeriodRange(p.startDate, p.endDate)} · ` : ""}
                      {formatGenerations(p.generations)}
                    </span>
                  </span>
                  <Chevron />
                </button>
              </li>
            ))}
          </ul>
          <GroupFooter>期間に入らない日は全期です。</GroupFooter>
        </>
      )}

      {draft ? (
        <PeriodSheet
          periods={periods}
          initial={draft}
          isAdmin={isAdmin}
          onClose={() => setDraft(null)}
          onSaved={() => {
            setDraft(null);
            void reload();
          }}
        />
      ) : null}
    </section>
  );
}

interface PublishedSlot {
  id: string;
  date: DateString;
  targetGenerations: number[] | null;
}

function PeriodSheet({
  periods,
  initial,
  isAdmin,
  onClose,
  onSaved,
}: {
  periods: GenerationPeriod[];
  initial: PeriodDraft;
  isAdmin: boolean;
  onClose: () => void;
  onSaved: () => void;
}) {
  const [draft, setDraft] = useState(initial);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [roster, setRoster] = useState<number[]>([]);
  /** 今日から先の公開済みの公式練。対象期が変わるかを先に数える (null = 読み込み中) */
  const [published, setPublished] = useState<PublishedSlot[] | null>(null);
  const today = todayInTokyo();

  useEffect(() => {
    let cancelled = false;
    const supabase = createClient();
    void (async () => {
      const [slotResult, rosterResult] = await Promise.all([
        selectAll<{ id: string; date: string; target_generations: number[] | null }>((from, to) =>
          supabase
            .from("slots")
            .select("id, date, target_generations")
            .eq("published", true)
            .eq("status", "genre")
            .gte("date", today)
            .order("date", { ascending: true })
            .order("id", { ascending: true })
            .range(from, to),
        ),
        supabase.from("profiles").select("generation").not("role", "in", OFF_ROSTER_ROLES),
      ]);
      if (cancelled) return;
      if (slotResult.error) {
        setError(dbErrorMessage("公開済みの公式練を確かめられませんでした", slotResult.error));
      } else {
        setPublished(
          slotResult.data.map((s) => ({
            id: s.id,
            date: s.date as DateString,
            targetGenerations: s.target_generations,
          })),
        );
      }
      setRoster(
        [...new Set(((rosterResult.data ?? []) as { generation: number }[]).map((p) => p.generation))],
      );
    })();
    return () => {
      cancelled = true;
    };
  }, [today]);

  const original = draft.id ? (periods.find((p) => p.id === draft.id) ?? null) : null;
  // 卒業した期が期間に残っていても、選んだままにできるよう候補に足す
  const candidates = useMemo(
    () => normalizeGenerations([...roster, ...initial.generations]) ?? [],
    [roster, initial.generations],
  );

  const invalid = validatePeriodDraft(draft);
  const after = invalid
    ? null
    : applyPeriod(periods, {
        id: draft.id,
        name: draft.name.trim() || null,
        startDate: draft.startDate,
        endDate: draft.endDate,
        generations: draft.generations,
      });
  const saveChanges =
    after && published
      ? changedSlots(published, after, affectedRange(original, draft), today)
      : [];
  const deleteChanges =
    original && published
      ? changedSlots(published, removePeriod(periods, original.id), affectedRange(original, null), today)
      : [];
  const blockedSave = !isAdmin && saveChanges.length > 0;
  const blockedDelete = !isAdmin && deleteChanges.length > 0;

  const set = <K extends keyof PeriodDraft>(key: K, value: PeriodDraft[K]) =>
    setDraft((current) => ({ ...current, [key]: value }));

  function toggle(generation: number) {
    set(
      "generations",
      draft.generations.includes(generation)
        ? draft.generations.filter((g) => g !== generation)
        : [...draft.generations, generation],
    );
  }

  async function submit(path: string, body: unknown, done: string, failure: string) {
    setPending(true);
    setError(null);
    try {
      const res = await fetch(path, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) {
        setError(json.error ?? failure);
        return;
      }
      showToast(json.notified ? `${done}・${json.notified}人に通知しました` : done);
      onSaved();
    } catch {
      setError(failure);
    } finally {
      setPending(false);
    }
  }

  async function save() {
    if (invalid) {
      setError(invalid);
      return;
    }
    const lines: string[] = [];
    const others = after ? describeOtherChanges(periods, after, draft.id) : [];
    if (others.length > 0) {
      lines.push(`ほかの期間も変わります。\n${others.map((line) => `・${line}`).join("\n")}`);
    }
    if (saveChanges.length > 0) {
      lines.push(
        `公開済みの公式練 ${saveChanges.length}件の対象期が変わります。対象から外れる人の出欠は消え、対象が変わる人に通知が届きます。`,
      );
      if (draft.startDate < today) lines.push("今日より前の練習はそのままです。");
    }
    if (
      lines.length > 0 &&
      !(await confirmAction({
        message: lines.join("\n\n"),
        confirmLabel: saveChanges.length > 0 ? "保存して通知する" : "保存する",
        destructive: false,
      }))
    ) {
      return;
    }
    await submit(
      "/api/generation-periods",
      {
        id: draft.id,
        updatedAt: draft.updatedAt,
        name: draft.name.trim(),
        startDate: draft.startDate,
        endDate: draft.endDate,
        generations: normalizeGenerations(draft.generations) ?? [],
      },
      "保存しました",
      "保存できませんでした。",
    );
  }

  async function remove() {
    if (!original) return;
    const label = `${original.name ? `${original.name} ` : ""}${formatPeriodRange(original.startDate, original.endDate)}`;
    const lines = [`「${label}」を削除しますか?\nこの期間の日は全期に戻ります。`];
    if (deleteChanges.length > 0) {
      lines.push(
        `公開済みの公式練 ${deleteChanges.length}件の対象期が変わります。対象が変わる人に通知が届きます。`,
      );
    }
    if (!(await confirmAction({ message: lines.join("\n\n"), confirmLabel: "削除する", destructive: true }))) {
      return;
    }
    await submit(
      "/api/generation-periods/delete",
      { id: original.id, updatedAt: original.updatedAt },
      "削除しました",
      "削除できませんでした。",
    );
  }

  const chip = (on: boolean) =>
    `rounded-full px-3 py-1.5 text-[15px] transition-colors disabled:opacity-40 ${
      on ? "bg-[var(--primary)] font-semibold text-[var(--primary-fg)]" : "bg-[var(--fill)]"
    }`;
  const datePill =
    "rounded-[8px] bg-[var(--fill)] px-2.5 py-1.5 text-[16px] tabular-nums outline-none";

  return (
    <Sheet
      title={draft.id ? "期間を編集" : "期間を追加"}
      onClose={onClose}
      footer={
        <div className="space-y-2">
          {blockedSave || blockedDelete ? (
            <p className="px-1 text-[13px] text-[var(--muted)]">
              公開済みの公式練の対象期が変わるので、3役だけが{blockedSave ? "保存" : "削除"}できます。
            </p>
          ) : null}
          <button
            type="button"
            onClick={save}
            disabled={pending || published === null || blockedSave}
            className={primaryButtonClass}
          >
            {saveChanges.length > 0 && isAdmin ? "保存して通知する" : draft.id ? "保存" : "追加"}
          </button>
          {original ? (
            <button
              type="button"
              onClick={remove}
              disabled={pending || published === null || blockedDelete}
              className={destructiveButtonClass}
            >
              削除
            </button>
          ) : null}
        </div>
      }
    >
      <div className="space-y-5">
        <ErrorMessage>{error}</ErrorMessage>
        <div className={groupClass}>
          <input
            aria-label="名前"
            placeholder="名前(例: 大祭練習・任意)"
            value={draft.name}
            maxLength={PERIOD_NAME_MAX}
            onChange={(e) => set("name", e.target.value)}
            className={cellInputClass}
          />
        </div>

        <div className={groupClass}>
          {(
            [
              ["startDate", "開始"],
              ["endDate", "終了"],
            ] as const
          ).map(([key, label]) => (
            <label key={key} className="flex min-h-[44px] items-center justify-between gap-3 px-4 py-1.5">
              <span className="text-[17px]">{label}</span>
              <input
                type="date"
                aria-label={`${label}日`}
                value={draft[key]}
                required
                onChange={(e) => e.target.value && set(key, e.target.value as DateString)}
                className={datePill}
              />
            </label>
          ))}
        </div>

        <div>
          <GroupHeader>対象期</GroupHeader>
          <div className="flex flex-wrap gap-2 px-1" role="group" aria-label="対象期">
            <button
              type="button"
              aria-pressed={draft.generations.length === 0}
              onClick={() => set("generations", [])}
              className={chip(draft.generations.length === 0)}
            >
              全期
            </button>
            {candidates.map((generation) => (
              <button
                key={generation}
                type="button"
                aria-pressed={draft.generations.includes(generation)}
                onClick={() => toggle(generation)}
                className={chip(draft.generations.includes(generation))}
              >
                {generation}期
              </button>
            ))}
          </div>
        </div>
      </div>
    </Sheet>
  );
}

function Chevron() {
  return (
    <svg
      aria-hidden
      viewBox="0 0 8 14"
      width="8"
      height="14"
      className="shrink-0 text-[var(--muted)] opacity-60"
    >
      <path
        d="M1 1l6 6-6 6"
        fill="none"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}
