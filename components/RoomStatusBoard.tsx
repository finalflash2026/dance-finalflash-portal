"use client";

import { useCallback, useState } from "react";

import { BoardMessages } from "@/components/BoardMessages";
import { Sheet } from "@/components/Sheet";
import { fillButtonClass, primaryButtonClass } from "@/components/ui";
import type { BoardMessage } from "@/lib/board-messages";
import { dbErrorMessage } from "@/lib/error-message";
import { useRooms } from "@/lib/rooms";
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
 * - **誰でも**切替可(権限制限なし)。後勝ち
 * - **押すと確認の窓が出て、「報告する」で初めて切り替わる** (v1.30 §6.7.6)。
 *   1タップで現役全員に通知が飛んでいたため、誤タップの影響が大きすぎた
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
  initialMessages,
  currentUserId,
}: {
  today: DateString;
  /** 今日、公開済み slots が1件以上ある部屋 */
  roomIds: number[];
  initialRows: RoomStatusRow[];
  /** 今日の連絡 (§6.1.3 / v1.27) */
  initialMessages: BoardMessage[];
  currentUserId: string;
}) {
  const allRooms = useRooms();
  const [rows, setRows] = useState(initialRows);
  const [fetchedAt, setFetchedAt] = useState<Date | null>(null);
  const [pendingRoomId, setPendingRoomId] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);
  /** 確認の窓を開いている部屋と、切り替えた後の状態 (v1.30) */
  const [confirming, setConfirming] = useState<{
    roomId: number;
    name: string;
    unlock: boolean;
  } | null>(null);

  const refresh = useCallback(async () => {
    const supabase = createClient();
    const { data, error: fetchError } = await supabase
      .from("room_status")
      .select("room_id, is_unlocked, updated_at, profiles(username)")
      .eq("date", today);

    if (fetchError) {
      setError(dbErrorMessage("最新の状態を取得できませんでした", fetchError));
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
      setError(data?.error ?? "切り替えに失敗しました。");
      setPendingRoomId(null);
      return;
    }
    await refresh();
    setPendingRoomId(null);
  }

  const rooms = allRooms.filter((room) => roomIds.includes(room.id));

  if (rooms.length === 0) {
    return (
      <section className="rounded-2xl bg-[var(--cell)] p-3" data-tour="room-board">
        <h2 className="text-[17px] font-bold">今日の練習場所</h2>
        <p className="mt-1 text-[15px] text-[var(--muted)]">
          今日は練習場所の予約がありません
        </p>
        {/* 予約が無い日でも連絡は残せる (鍵の受け渡しなど) */}
        <BoardMessages
          scope="room"
          date={today}
          initialMessages={initialMessages}
          currentUserId={currentUserId}
        />
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
    /*
     * v1.31.11: 見やすく作り直した。○× と 10px の凡例では読み取りにくかったので、
     * 状態は「開いている / 閉まっている」と言葉で出し、カードを大きくした
     */
    <section className="rounded-2xl bg-[var(--cell)] p-3" data-tour="room-board">
      <header className="flex items-center justify-between gap-2">
        <h2 className="text-[17px] font-bold">今日の練習場所</h2>
        <button
          type="button"
          onClick={refresh}
          aria-label="最新の状態にする"
          className="flex h-9 items-center gap-1.5 rounded-full bg-[var(--fill)] px-3 text-[13px] text-[var(--tint)] active:opacity-60"
        >
          <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" aria-hidden>
            <path d="M20 11a8 8 0 1 0-2.3 5.7M20 4v7h-7" />
          </svg>
          {fetchedAt ? `${formatAsTokyoTime(fetchedAt)} 時点` : "更新"}
        </button>
      </header>

      {error ? (
        <p role="alert" className="mt-1 text-xs text-[var(--danger-fg)]">
          {error}
        </p>
      ) : null}

      <ul className="mt-3 grid grid-cols-2 gap-2">
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
                onClick={() =>
                  setConfirming({ roomId: room.id, name: room.name, unlock: !unlocked })
                }
                disabled={pendingRoomId === room.id}
                aria-label={`${room.name} を${unlocked ? "施錠中" : "開錠済"}に切り替える`}
                aria-pressed={unlocked}
                className={`flex min-h-[64px] w-full flex-col items-start justify-between gap-1 rounded-xl border-2 px-3 py-2 text-left active:opacity-70 disabled:opacity-40 ${
                  unlocked
                    ? "border-[var(--success-fg)] bg-[var(--success-bg)]"
                    : "border-transparent bg-[var(--fill)]"
                } ${stale ? "opacity-60" : ""}`}
              >
                {/* 建物の括弧は落とす (「練習室2(フレスコ)」→「練習室2」)。細いカードで2行に折れないように */}
                <span className="w-full truncate text-[15px] font-semibold leading-snug">
                  {room.name.replace(/[(（][^)）]*[)）]$/, "") || room.name}
                </span>
                <span className="flex w-full items-center gap-1.5">
                  <span
                    aria-hidden
                    className={`h-2.5 w-2.5 shrink-0 rounded-full ${
                      unlocked ? "bg-[var(--success-fg)]" : "bg-[var(--muted)] opacity-60"
                    }`}
                  />
                  <span
                    className={`text-[14px] font-semibold ${
                      unlocked ? "text-[var(--success-fg)]" : "text-[var(--muted)]"
                    }`}
                  >
                    {unlocked ? "開いている" : "閉まっている"}
                  </span>
                </span>
                {unlocked && row ? (
                  <span className="w-full truncate text-[12px] text-[var(--muted)]">
                    {formatAsTokyoTime(row.updated_at)} {row.profiles?.username ?? ""}
                    {stale ? " (古いかも)" : ""}
                  </span>
                ) : null}
              </button>
            </li>
          );
        })}
      </ul>

      {confirming ? (
        <Sheet
          title={confirming.unlock ? "開けたことを報告" : "閉めたことを報告"}
          onClose={() => setConfirming(null)}
          footer={
            <div className="space-y-2">
              <button
                type="button"
                className={primaryButtonClass}
                onClick={() => {
                  const { roomId, unlock } = confirming;
                  setConfirming(null);
                  void toggle(roomId, !unlock);
                }}
              >
                {confirming.unlock ? "開けました" : "閉めました"}と報告する
              </button>
              <button
                type="button"
                className={fillButtonClass}
                onClick={() => setConfirming(null)}
              >
                やめる
              </button>
            </div>
          }
        >
          <p className="text-[17px] leading-relaxed">
            <strong>{confirming.name}</strong>を
            {confirming.unlock ? "「開いている」" : "「閉まっている」"}にして、
            現役全員に通知します。
          </p>
          <p className="mt-2 text-[15px] text-[var(--muted)]">
            {confirming.unlock
              ? "実際に鍵を開けたときだけ押してください。"
              : "実際に鍵を閉めたときだけ押してください。"}
          </p>
        </Sheet>
      ) : null}

      {/* ○×では表せない状況を書き残す欄 (§6.1.3)。中身は窓の中 */}
      <BoardMessages
        scope="room"
        date={today}
        initialMessages={initialMessages}
        currentUserId={currentUserId}
      />
    </section>
  );
}
