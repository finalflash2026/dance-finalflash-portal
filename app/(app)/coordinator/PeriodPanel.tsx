"use client";

import {
  nextPeriod,
  renumber,
  validatePeriods,
  type SlotPeriod,
} from "@/lib/slot-grid";
import { finalizeTimeInput, normalizeTimeInput, parseDate } from "@/lib/time";
import type { DateString } from "@/lib/types";

/**
 * この月の基準のコマ (SPEC.md §6.2 Step2-2 / v1.28, v1.29)
 *
 * 折衝の手順は**まずコマの時間を決める**ところから始まる。
 * ここで決めた時間が全ジャンルの練習時間の基準になり、表の ○ もこれで決まる。
 *
 * **打つそばから表に反映する。** 保存を待たせると、時間を1つ直すたびに
 * 保存→確認の往復になる。保存は「他の折衝係にも見せる」操作として分けてある。
 *
 * 日にちや建物ごとの例外はここでは扱わない (v1.29)。
 * **表の中の時間の列を直接いじる**ほうが、どの日のどの建物の話なのか
 * 迷わずに済む。
 */
export function PeriodPanel({
  month,
  base,
  snapshot,
  onChange,
  onSave,
  disabled,
}: {
  month: DateString;
  base: SlotPeriod[];
  snapshot: string;
  onChange: (periods: SlotPeriod[]) => void;
  onSave: (periods: SlotPeriod[]) => void;
  disabled: boolean;
}) {
  const { year, month: monthNumber } = parseDate(month);
  const dirty =
    base.map((p) => `${p.startTime}-${p.endTime}`).join(",") !== snapshot;
  const invalid = validatePeriods(base);

  const input =
    "w-[5.5rem] rounded border border-[var(--border)] bg-[var(--background)] px-2 py-1 text-sm tabular-nums outline-none focus:border-[var(--foreground)]";

  function update(index: number, patch: Partial<SlotPeriod>) {
    onChange(
      base.map((period, i) => (i === index ? { ...period, ...patch } : period)),
    );
  }

  return (
    <section className="space-y-3 rounded-xl border border-[var(--border)] p-3">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h3 className="text-sm font-bold">
          基準のコマ ({year}年{monthNumber}月)
        </h3>
        {dirty ? (
          <span className="text-xs text-[var(--danger-fg)]">
            未保存 — 保存するまで他の折衝係には見えません
          </span>
        ) : (
          <span className="text-xs text-[var(--muted)]">保存済み</span>
        )}
      </div>

      <div className="space-y-1">
        {base.map((period, index) => (
          <div key={index} className="flex items-center gap-2">
            <span className="w-14 text-xs text-[var(--muted)]">
              {index + 1}コマ目
            </span>
            <input
              aria-label={`${index + 1}コマ目の開始時刻`}
              value={period.startTime}
              inputMode="numeric"
              disabled={disabled}
              onChange={(e) =>
                update(index, { startTime: normalizeTimeInput(e.target.value) })
              }
              onBlur={(e) =>
                update(index, { startTime: finalizeTimeInput(e.target.value) })
              }
              className={input}
            />
            <span className="text-sm">〜</span>
            <input
              aria-label={`${index + 1}コマ目の終了時刻`}
              value={period.endTime}
              inputMode="numeric"
              disabled={disabled}
              onChange={(e) =>
                update(index, { endTime: normalizeTimeInput(e.target.value) })
              }
              onBlur={(e) =>
                update(index, { endTime: finalizeTimeInput(e.target.value) })
              }
              className={input}
            />
            <button
              type="button"
              disabled={disabled}
              aria-label={`${index + 1}コマ目を削除`}
              onClick={() => onChange(renumber(base.filter((_, i) => i !== index)))}
              className="rounded px-2 py-1 text-xs text-[var(--muted)] disabled:opacity-50"
            >
              ✕
            </button>
          </div>
        ))}

        <button
          type="button"
          disabled={disabled || base.length >= 12}
          onClick={() => onChange([...base, nextPeriod(base)])}
          className="rounded-lg border border-[var(--border)] px-3 py-1 text-xs disabled:opacity-50"
        >
          ＋ コマを足す
        </button>
      </div>

      {invalid ? (
        <p role="alert" className="text-xs text-[var(--danger-fg)]">
          {invalid}
        </p>
      ) : null}

      <div className="flex flex-wrap items-center gap-2">
        <button
          type="button"
          disabled={disabled || !!invalid}
          onClick={() => onSave(base)}
          className="rounded-lg bg-[var(--primary)] px-4 py-1.5 text-sm font-bold text-[var(--primary-fg)] disabled:opacity-50"
        >
          保存する
        </button>
        <span className="text-xs text-[var(--muted)]">
          特定の日や建物だけ違うときは、下の表の<strong>時間の列</strong>を直接押してください
        </span>
      </div>
    </section>
  );
}
