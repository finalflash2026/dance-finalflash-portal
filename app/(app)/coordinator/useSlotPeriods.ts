"use client";

import { useCallback, useEffect, useState } from "react";

import {
  DEFAULT_PERIODS,
  overrideKey,
  periodsFor,
  renumber,
  type PeriodTable,
  type SlotPeriod,
} from "@/lib/slot-grid";
import { createClient } from "@/lib/supabase/client";
import { endOfMonth, normalizeTime, startOfMonth } from "@/lib/time";
import type { DateString } from "@/lib/types";

/**
 * その月のコマの時間を読み書きする (SPEC.md §6.2 Step2 / v1.28, v1.29)
 *
 * 2段構え:
 *   **基準** … その月の区切り。折衝がまずこれを入れる。下書きで持ち、保存で確定
 *   **上書き** … 日にち×所在ごとの例外。表のセルを直すと**その場で保存**する
 *
 * 基準だけ下書きにしてあるのは、打っている途中の値が他の折衝係に
 * 見えてしまうのを避けるため。上書きは1か所を直す操作なので、
 * 押した時点で確定させたほうが手数が少ない。
 *
 * 保存されていない月は**既定の4コマを下書きとして返す**。
 * 空の表を出して「まず時間を入れてください」と言うより、
 * いつもの時間で ○ が付いた表をいきなり見せたほうが早い。
 */

interface RawBase {
  position: number;
  start_time: string;
  end_time: string;
}

interface RawOverride extends RawBase {
  date: DateString;
  section: string;
}

function toPeriods(rows: RawBase[]): SlotPeriod[] {
  return rows
    .map((row) => ({
      position: row.position,
      startTime: normalizeTime(row.start_time),
      endTime: normalizeTime(row.end_time),
    }))
    .sort((a, b) => a.position - b.position);
}

function describe(periods: SlotPeriod[]): string {
  return periods.map((p) => `${p.startTime}-${p.endTime}`).join(",");
}

/** 上書きが基準と同じ内容になったら、行を残さず消す (表を汚さない) */
function sameAsBase(periods: SlotPeriod[], base: SlotPeriod[]): boolean {
  return describe(periods) === describe(base);
}

export function useSlotPeriods(month: DateString) {
  const [table, setTable] = useState<PeriodTable>({
    base: [...DEFAULT_PERIODS],
    overrides: new Map(),
  });
  /** 保存されている基準。打ちかけのまま離れていないかを見るために持つ */
  const [snapshot, setSnapshot] = useState("");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    const supabase = createClient();
    const [baseResult, overrideResult] = await Promise.all([
      supabase
        .from("slot_period_base")
        .select("position, start_time, end_time")
        .eq("month", month),
      supabase
        .from("slot_period_overrides")
        .select("date, section, position, start_time, end_time")
        .gte("date", startOfMonth(month))
        .lte("date", endOfMonth(month)),
    ]);
    setLoading(false);

    if (baseResult.error || overrideResult.error) {
      setError(
        `コマの時間を取得できませんでした: ${
          (baseResult.error ?? overrideResult.error)?.message
        }`,
      );
      return;
    }
    setError(null);

    const baseRows = (baseResult.data ?? []) as RawBase[];
    const base = baseRows.length > 0 ? toPeriods(baseRows) : [...DEFAULT_PERIODS];

    const overrides = new Map<string, SlotPeriod[]>();
    const rows = (overrideResult.data ?? []) as RawOverride[];
    for (const key of new Set(rows.map((r) => overrideKey(r.date, r.section)))) {
      overrides.set(
        key,
        toPeriods(
          rows.filter((r) => overrideKey(r.date, r.section) === key),
        ),
      );
    }

    setSnapshot(baseRows.length > 0 ? describe(base) : "");
    setTable({ base, overrides });
  }, [month]);

  useEffect(() => {
    load();
  }, [load]);

  /**
   * 月の基準を保存する。
   *
   * **upsert が先、余りの削除が後。** 逆にすると、途中で失敗したときに
   * コマの時間が1つも無い月になり、表から ○ が全部消える。
   */
  const saveBase = useCallback(
    async (periods: SlotPeriod[]): Promise<boolean> => {
      const supabase = createClient();
      const rows = renumber(periods).map((period) => ({
        month,
        position: period.position,
        start_time: period.startTime,
        end_time: period.endTime,
      }));

      if (rows.length > 0) {
        const { error: upsertError } = await supabase
          .from("slot_period_base")
          .upsert(rows, { onConflict: "month,position" });
        if (upsertError) {
          setError(`コマの時間を保存できませんでした: ${upsertError.message}`);
          return false;
        }
      }
      const { error: deleteError } = await supabase
        .from("slot_period_base")
        .delete()
        .eq("month", month)
        .gt("position", rows.length);
      if (deleteError) {
        setError(`古いコマを消せませんでした: ${deleteError.message}`);
        return false;
      }

      setError(null);
      await load();
      return true;
    },
    [month, load],
  );

  /**
   * 日にち×所在の上書きをまとめて保存する。
   *
   * 「この場所の全日に適用」「この日の全場所に適用」でも同じ道を通る。
   * 基準と同じ内容になったものは**行を作らず消す** — 上書きが残っていると、
   * あとで基準を直したときにそこだけ古い時間のままになる。
   */
  const saveOverrides = useCallback(
    async (
      entries: { date: DateString; section: string; periods: SlotPeriod[] }[],
      base: SlotPeriod[],
    ): Promise<boolean> => {
      const supabase = createClient();
      const toWrite = entries.filter((e) => !sameAsBase(e.periods, base));
      const toDelete = entries.filter((e) => sameAsBase(e.periods, base));

      const rows = toWrite.flatMap((entry) =>
        renumber(entry.periods).map((period) => ({
          date: entry.date,
          section: entry.section,
          position: period.position,
          start_time: period.startTime,
          end_time: period.endTime,
        })),
      );

      if (rows.length > 0) {
        const { error: upsertError } = await supabase
          .from("slot_period_overrides")
          .upsert(rows, { onConflict: "date,section,position" });
        if (upsertError) {
          setError(`コマの時間を保存できませんでした: ${upsertError.message}`);
          return false;
        }
      }

      // 余ったコマ (減らしたぶん) と、基準に戻したぶんを消す
      for (const entry of toWrite) {
        const { error: trimError } = await supabase
          .from("slot_period_overrides")
          .delete()
          .eq("date", entry.date)
          .eq("section", entry.section)
          .gt("position", entry.periods.length);
        if (trimError) {
          setError(`古いコマを消せませんでした: ${trimError.message}`);
          return false;
        }
      }
      for (const entry of toDelete) {
        const { error: dropError } = await supabase
          .from("slot_period_overrides")
          .delete()
          .eq("date", entry.date)
          .eq("section", entry.section);
        if (dropError) {
          setError(`上書きを消せませんでした: ${dropError.message}`);
          return false;
        }
      }

      setError(null);
      await load();
      return true;
    },
    [load],
  );

  /** その日の全所在でコマを1つ増やす / 減らす */
  const changeRowCount = useCallback(
    async (
      date: DateString,
      sections: readonly string[],
      next: (periods: SlotPeriod[]) => SlotPeriod[],
    ): Promise<boolean> => {
      const entries = sections.map((section) => ({
        date,
        section,
        periods: next(periodsFor(table, date, section)),
      }));
      return saveOverrides(entries, table.base);
    },
    [table, saveOverrides],
  );

  return {
    table,
    setTable,
    snapshot,
    loading,
    error,
    setError,
    saveBase,
    saveOverrides,
    changeRowCount,
    reload: load,
  };
}
