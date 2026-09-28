"use client";

import { useRoomSections } from "@/lib/rooms";
import {
  BASE_SECTION,
  periodsForSection,
  serializePeriodTable,
  validatePeriods,
  type PeriodTable,
  type SlotPeriod,
} from "@/lib/slot-grid";
import { finalizeTimeInput, normalizeTimeInput, parseDate } from "@/lib/time";
import type { DateString } from "@/lib/types";

/**
 * この月のコマの時間 (SPEC.md §6.2 Step2-2 / v1.28)
 *
 * 折衝の手順は**まずコマの時間を決める**ところから始まる。
 * ここで決めた時間が全ジャンルの練習時間の基準になり、表の ○ もこれで決まる。
 *
 * **打つそばから表に反映する。** 保存を待たせると、時間を1つ直すたびに
 * 保存→確認の往復になる。保存は「他の折衝係にも見せる」操作として分けてある。
 *
 * 所在ごとの上書きは**まれ**なので、既定では畳んでおく
 * (施設の都合で1か所だけ区切りが違う月がある)。
 */
export function PeriodPanel({
  month,
  table,
  snapshot,
  onChange,
  onSave,
  onClearOverride,
  disabled,
}: {
  month: DateString;
  table: PeriodTable;
  snapshot: string;
  onChange: (table: PeriodTable) => void;
  onSave: (section: string, periods: SlotPeriod[]) => void;
  onClearOverride: (section: string) => void;
  disabled: boolean;
}) {
  const sections = useRoomSections();
  const { year, month: monthNumber } = parseDate(month);
  const dirty = serializePeriodTable(table) !== snapshot;
  const invalid = validatePeriods(table.base);

  function setBase(periods: SlotPeriod[]) {
    onChange({ ...table, base: renumber(periods) });
  }

  function setOverride(section: string, periods: SlotPeriod[]) {
    const overrides = new Map(table.overrides);
    overrides.set(section, renumber(periods));
    onChange({ ...table, overrides });
  }

  function addOverride(section: string) {
    const overrides = new Map(table.overrides);
    // 基準をそのまま複製する。ゼロから打たせると、ズレているのは
    // たいてい1コマだけなのに全部打ち直すことになる
    overrides.set(section, table.base.map((period) => ({ ...period })));
    onChange({ ...table, overrides });
  }

  function dropOverride(section: string) {
    const overrides = new Map(table.overrides);
    overrides.delete(section);
    onChange({ ...table, overrides });
    onClearOverride(section);
  }

  return (
    <section className="space-y-3 rounded-xl border border-[var(--border)] p-3">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h3 className="text-sm font-bold">
          コマの時間 ({year}年{monthNumber}月)
        </h3>
        {dirty ? (
          <span className="text-xs text-[var(--danger-fg)]">
            未保存 — 保存するまで他の折衝係には見えません
          </span>
        ) : (
          <span className="text-xs text-[var(--muted)]">保存済み</span>
        )}
      </div>

      <PeriodList
        periods={table.base}
        disabled={disabled}
        onChange={setBase}
      />

      {invalid ? (
        <p role="alert" className="text-xs text-[var(--danger-fg)]">
          {invalid}
        </p>
      ) : null}

      <div className="flex flex-wrap gap-2">
        <button
          type="button"
          disabled={disabled || !!invalid}
          onClick={() => onSave(BASE_SECTION, table.base)}
          className="rounded-lg bg-[var(--primary)] px-4 py-1.5 text-sm font-bold text-[var(--primary-fg)] disabled:opacity-50"
        >
          保存する
        </button>
      </div>

      <details>
        <summary className="cursor-pointer text-xs text-[var(--muted)]">
          特定の場所だけ時間をずらす ({table.overrides.size}件)
        </summary>

        <div className="mt-2 space-y-3">
          <div className="flex flex-wrap gap-1.5">
            {sections.map((group) => {
              const on = table.overrides.has(group.section);
              return (
                <button
                  key={group.section}
                  type="button"
                  disabled={disabled}
                  aria-pressed={on}
                  onClick={() =>
                    on ? dropOverride(group.section) : addOverride(group.section)
                  }
                  className={`rounded-full border px-2.5 py-1 text-xs disabled:opacity-50 ${
                    on
                      ? "border-[var(--primary)] bg-[var(--primary)] font-bold text-[var(--primary-fg)]"
                      : "border-[var(--border)]"
                  }`}
                >
                  {group.section}
                </button>
              );
            })}
          </div>

          {[...table.overrides.keys()].map((section) => {
            const periods = periodsForSection(table, section);
            const message = validatePeriods(periods);
            return (
              <div
                key={section}
                className="space-y-2 rounded-lg border border-[var(--border)] p-2"
              >
                <p className="text-xs font-bold">{section} だけの時間</p>
                <PeriodList
                  periods={periods}
                  disabled={disabled}
                  onChange={(next) => setOverride(section, next)}
                />
                {message ? (
                  <p role="alert" className="text-xs text-[var(--danger-fg)]">
                    {message}
                  </p>
                ) : null}
                <div className="flex gap-2">
                  <button
                    type="button"
                    disabled={disabled || !!message}
                    onClick={() => onSave(section, periods)}
                    className="rounded-lg border border-[var(--border)] px-3 py-1 text-xs font-bold disabled:opacity-50"
                  >
                    保存する
                  </button>
                  <button
                    type="button"
                    disabled={disabled}
                    onClick={() => dropOverride(section)}
                    className="rounded-lg border border-[var(--border)] px-3 py-1 text-xs text-[var(--danger-fg)] disabled:opacity-50"
                  >
                    基準に戻す
                  </button>
                </div>
              </div>
            );
          })}
        </div>
      </details>
    </section>
  );
}

/** position を 1 から振り直す。消したり足したりしても番号が飛ばないように */
function renumber(periods: SlotPeriod[]): SlotPeriod[] {
  return periods.map((period, index) => ({ ...period, position: index + 1 }));
}

function PeriodList({
  periods,
  disabled,
  onChange,
}: {
  periods: SlotPeriod[];
  disabled: boolean;
  onChange: (periods: SlotPeriod[]) => void;
}) {
  const input =
    "w-[5.5rem] rounded border border-[var(--border)] bg-[var(--background)] px-2 py-1 text-sm tabular-nums outline-none focus:border-[var(--foreground)]";

  function update(index: number, patch: Partial<SlotPeriod>) {
    onChange(
      periods.map((period, i) => (i === index ? { ...period, ...patch } : period)),
    );
  }

  return (
    <div className="space-y-1">
      {periods.map((period, index) => (
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
            onClick={() => onChange(periods.filter((_, i) => i !== index))}
            className="rounded px-2 py-1 text-xs text-[var(--muted)] disabled:opacity-50"
          >
            ✕
          </button>
        </div>
      ))}

      <button
        type="button"
        disabled={disabled || periods.length >= 12}
        onClick={() =>
          onChange([
            ...periods,
            {
              position: periods.length + 1,
              startTime: "",
              endTime: "",
            },
          ])
        }
        className="rounded-lg border border-[var(--border)] px-3 py-1 text-xs disabled:opacity-50"
      >
        ＋ コマを足す
      </button>
    </div>
  );
}
