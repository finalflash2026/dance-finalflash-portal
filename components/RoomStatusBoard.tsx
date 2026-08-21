"use client";

import { useCallback, useState } from "react";

import { ROOMS } from "@/lib/constants";
import { createClient } from "@/lib/supabase/client";
import { useLiveRefresh } from "@/lib/use-live-refresh";
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

/**
 * 自動再取得の間隔。**15秒** (SPEC §6.1.1 / v1.14 で60秒から短縮)。
 * 鍵を開けた直後に他の人の画面へ反映されないと、行ってから
 * 「開いていない」と勘違いされるため。非表示の間は止まる (useLiveRefresh)。
 */
const POLL_INTERVAL_MS = 15_000;
/** ○ のまま放置されたとみなす閾値 (SPEC §6.1.1「3時間以上経過」) */
const STALE_THRESHOLD_MS = 3 * 60 * 60 * 1000;

export function RoomStatusBoard({
  today,
  roomIds,
  initialRows,
}: {
  today: DateString;
  /** 今日、公開済み slots が1件以上ある部屋 */
  roomIds: number[];
  initialRows: RoomStatusRow[];
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

  // ポーリングするのは room_status だけで、**部屋の一覧はサーバー描画時のものを使う**。
  // 折衝が閲覧中に新しい部屋を公開した場合はリロードまで反映されないが、
  // 頻度が低いのに対しクエリを半減できるため、この割り切りを採る。
  useLiveRefresh(refresh, POLL_INTERVAL_MS);

  /**
   * 切り替えは **API 経由** (v1.15)。以前はここから直接 upsert していたが、
   * プッシュ通知をこの操作から出すようになったため、ブラウザに書かせると
   * **切り替えていないのに「開錠しました」を全員へ投げられてしまう**。
   * サーバー側もセッションのクライアントで書くので、RLS の条件
   * (当日のみ・本人・OB 不可) はこれまで通り効く。
   */
  async function toggle(roomId: number, current: boolean) {
    setPendingRoomId(roomId);
    setError(null);

    const res = await fetch("/api/room-status", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ roomId, isUnlocked: !current }),
    });

    if (!res.ok) {
      const data = (await res.json().catch(() => null)) as {
        error?: string;
      } | null;
      setError(data?.error ?? "切り替えに失敗しました");
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
    /*
     * 縦を詰めるため2列のグリッドにしてある。1行1部屋の縦並びだと
     * 部屋数ぶんそのまま高さになり、下の日別ビューが画面外まで押し出されていた。
     * 「誰がいつ開けたか」は ○ のときだけ出す (× は既定値で、誰も触っていない
     * ことがほとんどのため表示する価値が薄い)。
     */
    <section className="rounded-xl border border-[var(--border)] p-2">
      <header className="flex items-baseline justify-between gap-2">
        <h2 className="text-sm font-bold">今日の練習場所</h2>
        <div className="flex items-center gap-2 text-[10px] text-[var(--muted)]">
          <span>○=開錠 ×=施錠</span>
          {fetchedAt ? <span>{formatAsTokyoTime(fetchedAt)}</span> : null}
          <button
            type="button"
            onClick={refresh}
            className="rounded border border-[var(--border)] px-1.5 py-0.5"
          >
            更新
          </button>
        </div>
      </header>

      {error ? (
        <p role="alert" className="mt-1 text-xs text-[var(--danger-fg)]">
          {error}
        </p>
      ) : null}

      <ul className="mt-1.5 grid grid-cols-2 gap-1">
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
            <li key={room.id}>
              <button
                type="button"
                onClick={() => toggle(room.id, unlocked)}
                disabled={pendingRoomId === room.id}
                aria-label={`${room.name} を${unlocked ? "施錠中" : "開錠済"}に切り替える`}
                aria-pressed={unlocked}
                className={`flex w-full items-center gap-1.5 rounded-lg border px-2 py-1 text-left disabled:opacity-40 ${
                  unlocked
                    ? "border-[var(--success-fg)] bg-[var(--success-bg)]"
                    : "border-[var(--border)] bg-[var(--surface)]"
                } ${stale ? "opacity-60" : ""}`}
              >
                <span
                  className={`shrink-0 text-base font-bold ${
                    unlocked ? "text-[var(--success-fg)]" : "text-[var(--muted)]"
                  }`}
                >
                  {unlocked ? "○" : "×"}
                </span>
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-xs leading-tight">
                    {room.name}
                  </span>
                  {unlocked && row ? (
                    <span className="block truncate text-[10px] text-[var(--muted)]">
                      {formatAsTokyoTime(row.updated_at)}{" "}
                      {row.profiles?.username ?? ""}
                      {stale ? " (古いかも)" : ""}
                    </span>
                  ) : null}
                </span>
              </button>
            </li>
          );
        })}
      </ul>
    </section>
  );
}
