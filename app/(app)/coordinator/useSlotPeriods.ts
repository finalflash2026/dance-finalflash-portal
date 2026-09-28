"use client";

import { useCallback, useEffect, useState } from "react";

import {
  BASE_SECTION,
  DEFAULT_PERIODS,
  serializePeriodTable,
  type PeriodTable,
  type SlotPeriod,
} from "@/lib/slot-grid";
import { createClient } from "@/lib/supabase/client";
import { normalizeTime } from "@/lib/time";
import type { DateString } from "@/lib/types";

/**
 * その月のコマの時間を読み書きする (SPEC.md §6.2 Step2 / v1.28)
 *
 * 保存されていない月は**既定の4コマを下書きとして返す**。
 * 空の表を出して「まず時間を入れてください」と言うより、
 * いつもの時間で ○ が付いた表をいきなり見せたほうが早い。
 * 保存するまでこの端末だけの下書きで、他の折衝係には見えない。
 */

interface RawPeriod {
  section: string;
  position: number;
  start_time: string;
  end_time: string;
}

function toPeriods(rows: RawPeriod[]): SlotPeriod[] {
  return rows
    .map((row) => ({
      position: row.position,
      startTime: normalizeTime(row.start_time),
      endTime: normalizeTime(row.end_time),
    }))
    .sort((a, b) => a.position - b.position);
}

export function useSlotPeriods(month: DateString) {
  const [table, setTable] = useState<PeriodTable>({
    base: [...DEFAULT_PERIODS],
    overrides: new Map(),
  });
  /** DB に1行も無い = まだ誰も決めていない月。画面で「未保存」を出す */
  const [saved, setSaved] = useState(false);
  /** 保存されている内容。打ちかけのまま離れていないかを見るために持つ */
  const [snapshot, setSnapshot] = useState("");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    const supabase = createClient();
    const { data, error: fetchError } = await supabase
      .from("slot_periods")
      .select("section, position, start_time, end_time")
      .eq("month", month);
    setLoading(false);

    if (fetchError) {
      setError(`コマの時間を取得できませんでした: ${fetchError.message}`);
      return;
    }
    setError(null);

    const rows = (data ?? []) as RawPeriod[];
    const base = rows.filter((row) => row.section === BASE_SECTION);
    const overrides = new Map<string, SlotPeriod[]>();
    const sections = new Set(
      rows.filter((row) => row.section !== BASE_SECTION).map((r) => r.section),
    );
    for (const section of sections) {
      overrides.set(
        section,
        toPeriods(rows.filter((row) => row.section === section)),
      );
    }

    const loaded: PeriodTable = {
      base: base.length > 0 ? toPeriods(base) : [...DEFAULT_PERIODS],
      overrides,
    };
    setSaved(rows.length > 0);
    setSnapshot(rows.length > 0 ? serializePeriodTable(loaded) : "");
    setTable(loaded);
  }, [month]);

  useEffect(() => {
    load();
  }, [load]);

  /**
   * 1つの所在ぶんを保存する。
   *
   * **upsert が先、余りの削除が後。** 逆にすると、途中で失敗したときに
   * コマの時間が1つも無い月になり、表から ○ が全部消える。
   */
  const save = useCallback(
    async (section: string, periods: SlotPeriod[]): Promise<boolean> => {
      const supabase = createClient();
      const rows = periods.map((period, index) => ({
        month,
        section,
        position: index + 1,
        start_time: period.startTime,
        end_time: period.endTime,
      }));

      if (rows.length > 0) {
        const { error: upsertError } = await supabase
          .from("slot_periods")
          .upsert(rows, { onConflict: "month,section,position" });
        if (upsertError) {
          setError(`コマの時間を保存できませんでした: ${upsertError.message}`);
          return false;
        }
      }

      const { error: deleteError } = await supabase
        .from("slot_periods")
        .delete()
        .eq("month", month)
        .eq("section", section)
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

  /** 所在ごとの上書きをやめて基準に戻す */
  const clearOverride = useCallback(
    async (section: string): Promise<boolean> => {
      const supabase = createClient();
      const { error: deleteError } = await supabase
        .from("slot_periods")
        .delete()
        .eq("month", month)
        .eq("section", section);
      if (deleteError) {
        setError(`上書きを消せませんでした: ${deleteError.message}`);
        return false;
      }
      setError(null);
      await load();
      return true;
    },
    [month, load],
  );

  return {
    table,
    setTable,
    saved,
    snapshot,
    loading,
    error,
    setError,
    save,
    clearOverride,
  };
}
