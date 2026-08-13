"use client";

import { useCallback, useEffect, useState } from "react";

import { ROOMS } from "@/lib/constants";
import { createClient } from "@/lib/supabase/client";
import { formatAsTokyoTime } from "@/lib/time";
import type { DateString } from "@/lib/types";

/**
 * 「今日の練習場所」施錠状況ボード (SPEC.md §6.1.1)
 *
 * 鍵の状態を全員で共有する掲示板。**予約や申請とは完全に独立**していて、
 * × でもその部屋の予約・申請は有効なまま(鍵を取りに行けば使える)。
 *
 *   × = 施錠中。入室には鍵を取りに行く必要がある
 *   ○ = 開錠済。誰かが既に開けているのでそのまま入れる
 *
 * - 行が無い部屋は既定で ×(施錠中)
 * - **誰でも**タップで切替可(権限制限なし)。確認ダイアログなし、即 upsert、後勝ち
 * - お知らせ通知は発生させない(切替が頻繁で通知過多になるため)
 * - 日付をキーに含むので、日付が変われば自動的に全部屋が × に戻る
 */

export interface RoomStatusRow {
  room_id: number;
  is_unlocked: boolean;
  updated_at: string;
  profiles: { username: string } | null;
}

/** 自動再取得の間隔 (SPEC §6.1.1「60秒ごとに自動再取得」) */
const POLL_INTERVAL_MS = 60_000;
/** ○ のまま放置されたとみなす閾値 (SPEC §6.1.1「3時間以上経過」) */
const STALE_THRESHOLD_MS = 3 * 60 * 60 * 1000;

export function RoomStatusBoard({
  today,
  roomIds,
  initialRows,
  currentUserId,
}: {
  today: DateString;
  /** 今日、公開済み slots が1件以上ある部屋 */
  roomIds: number[];
  initialRows: RoomStatusRow[];
  currentUserId: string;
}) {
  const [rows, setRows] = useState(initialRows);
  const [fetchedAt, setFetchedAt] = useState<Date | null>(null);
  const [pendingRoomId, setPendingRoomId] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    const supabase = createClient();
    const { data, error: fetchError } = await supabase
      .from("room_status")
      .select("room_id, is_unlocked, updated_at, profiles(username)")
      .eq("date", today);

    if (fetchError) {
      setError(`最新の状態を取得できませんでした: ${fetchError.message}`);
      return;
    }
    setError(null);
    setRows((data ?? []) as unknown as RoomStatusRow[]);
    setFetchedAt(new Date());
  }, [today]);

  // 60秒ごとに自動再取得。
  // ポーリングするのは room_status だけで、**部屋の一覧はサーバー描画時のものを使う**。
  // 折衝が閲覧中に新しい部屋を公開した場合はリロードまで反映されないが、
  // 頻度が低いのに対しクエリを半減できるため、この割り切りを採る。
  useEffect(() => {
    const timer = setInterval(refresh, POLL_INTERVAL_MS);
    return () => clearInterval(timer);
  }, [refresh]);

  async function toggle(roomId: number, current: boolean) {
    setPendingRoomId(roomId);
    setError(null);

    const supabase = createClient();
    const { error: upsertError } = await supabase.from("room_status").upsert(
      {
        date: today,
        room_id: roomId,
        is_unlocked: !current,
        // RLS が updated_by = auth.uid() を要求する。なりすましは DB で弾かれる
        updated_by: currentUserId,
      },
      { onConflict: "date,room_id" },
    );

    if (upsertError) {
      setError(`切り替えに失敗しました: ${upsertError.message}`);
      setPendingRoomId(null);
      return;
    }
    await refresh();
    setPendingRoomId(null);
  }

  const rooms = ROOMS.filter((room) => roomIds.includes(room.id));

  if (rooms.length === 0) {
    return (
      <section className="rounded-xl border border-[var(--border)] px-4 py-3 text-sm text-[var(--muted)]">
        今日は練習場所の予約がありません
      </section>
    );
  }

  const byRoomId = new Map(rows.map((row) => [row.room_id, row]));

  return (
    <section className="rounded-xl border border-[var(--border)] p-3">
      <header className="flex items-baseline justify-between gap-2">
        <h2 className="text-base font-bold">今日の練習場所</h2>
        <div className="flex items-center gap-2 text-xs text-[var(--muted)]">
          {fetchedAt ? <span>最終取得 {formatAsTokyoTime(fetchedAt)}</span> : null}
          <button
            type="button"
            onClick={refresh}
            className="rounded border border-[var(--border)] px-2 py-0.5"
          >
            更新
          </button>
        </div>
      </header>

      <p className="mt-1 text-xs text-[var(--muted)]">
        ○ = 開錠済(そのまま入れる) / × = 施錠中(鍵を取りに行く)
      </p>

      {error ? (
        <p role="alert" className="mt-2 text-xs text-[#8B1A10]">
          {error}
        </p>
      ) : null}

      <ul className="mt-2 divide-y divide-[var(--border)]">
        {rooms.map((room) => {
          const row = byRoomId.get(room.id);
          // 行が無い = 未設定。UI 上は × (施錠中) を既定とする
          const unlocked = row?.is_unlocked ?? false;
          const stale =
            unlocked &&
            row != null &&
            Date.now() - new Date(row.updated_at).getTime() >
              STALE_THRESHOLD_MS;

          return (
            <li
              key={room.id}
              className={`flex items-center gap-3 py-2 ${stale ? "opacity-50" : ""}`}
            >
              <div className="min-w-0 flex-1">
                <p className="truncate text-sm">{room.name}</p>
                {row ? (
                  <p className="truncate text-xs text-[var(--muted)]">
                    {formatAsTokyoTime(row.updated_at)}{" "}
                    {row.profiles?.username ?? ""}
                    {stale ? " (情報が古い可能性)" : ""}
                  </p>
                ) : null}
              </div>

              <button
                type="button"
                onClick={() => toggle(room.id, unlocked)}
                disabled={pendingRoomId === room.id}
                aria-label={`${room.name} を${unlocked ? "施錠中" : "開錠済"}に切り替える`}
                aria-pressed={unlocked}
                className={`h-10 w-10 shrink-0 rounded-full border text-lg font-bold disabled:opacity-40 ${
                  unlocked
                    ? "border-[#2E8B57] bg-[#E8F5EE] text-[#2E8B57]"
                    : "border-[var(--border)] bg-[var(--surface)] text-[var(--muted)]"
                }`}
              >
                {unlocked ? "○" : "×"}
              </button>
            </li>
          );
        })}
      </ul>
    </section>
  );
}
