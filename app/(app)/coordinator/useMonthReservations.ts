"use client";

import { useCallback, useEffect, useState } from "react";

import type { SlotInfo } from "@/lib/slots";
import { createClient } from "@/lib/supabase/client";
import { endOfMonth, normalizeTime, startOfMonth } from "@/lib/time";
import type { DateString } from "@/lib/types";

/**
 * 月ぶんの予約枠とコマを読む (SPEC.md §6.2 Step2 / §13.1)
 *
 * Step2 (コマ割り) と Step3 (公開) が同じ形のデータを見るので共有する。
 * **埋め込みで1クエリにまとめる** (§13.1「1画面あたりのDBクエリは埋め込みで
 * まとめ、N+1にしない」)。
 *
 * 読み出しは RLS 任せ (all_resv / sel_slots_pub / sel_claims がいずれも
 * coordinator 以上を許可している)。service role は使わない。
 */

export interface ReservationInfo {
  id: string;
  date: DateString;
  startTime: string;
  endTime: string;
  roomId: number;
  slots: SlotInfo[];
}

interface RawClaim {
  id: string;
  start_time: string;
  end_time: string;
  profiles: { username: string } | null;
}

interface RawSlot {
  id: string;
  start_time: string;
  end_time: string;
  status: SlotInfo["status"];
  genre_id: number | null;
  target_generations: number[] | null;
  published: boolean;
  claims: RawClaim[] | null;
}

interface RawReservation {
  id: string;
  date: DateString;
  start_time: string;
  end_time: string;
  room_id: number;
  slots: RawSlot[] | null;
}

export function useMonthReservations(month: DateString) {
  const [reservations, setReservations] = useState<ReservationInfo[]>([]);
  const [generations, setGenerations] = useState<number[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    const supabase = createClient();

    const [resvResult, profileResult] = await Promise.all([
      supabase
        .from("reservations")
        .select(
          "id, date, start_time, end_time, room_id, slots(id, start_time, end_time, status, genre_id, target_generations, published, claims(id, start_time, end_time, profiles(username)))",
        )
        .eq("status", "active")
        .gte("date", startOfMonth(month))
        .lte("date", endOfMonth(month))
        .order("date"),
      // 対象期のチェックボックスに出す候補。OB も含めて実在する期だけを出す
      supabase.from("profiles").select("generation"),
    ]);

    setLoading(false);

    if (resvResult.error) {
      setError(`予約枠を取得できませんでした: ${resvResult.error.message}`);
      return;
    }
    if (profileResult.error) {
      setError(`期の一覧を取得できませんでした: ${profileResult.error.message}`);
      return;
    }

    setReservations(
      ((resvResult.data ?? []) as unknown as RawReservation[]).map((row) => ({
        id: row.id,
        date: row.date,
        startTime: normalizeTime(row.start_time),
        endTime: normalizeTime(row.end_time),
        roomId: row.room_id,
        slots: (row.slots ?? []).map((slot) => ({
          id: slot.id,
          startTime: normalizeTime(slot.start_time),
          endTime: normalizeTime(slot.end_time),
          status: slot.status,
          genreId: slot.genre_id,
          targetGenerations: slot.target_generations,
          published: slot.published,
          claims: (slot.claims ?? []).map((claim) => ({
            id: claim.id,
            username: claim.profiles?.username ?? "(不明)",
            startTime: normalizeTime(claim.start_time),
            endTime: normalizeTime(claim.end_time),
          })),
        })),
      })),
    );

    setGenerations(
      [
        ...new Set(
          ((profileResult.data ?? []) as { generation: number }[]).map(
            (p) => p.generation,
          ),
        ),
      ].sort((a, b) => b - a),
    );
  }, [month]);

  useEffect(() => {
    load();
  }, [load]);

  return { reservations, generations, loading, error, reload: load, setError };
}
