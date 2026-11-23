"use client";

import { useCallback, useEffect, useRef, useState } from "react";

import { BoardMessages } from "@/components/BoardMessages";
import { Sheet } from "@/components/Sheet";
import type { BoardMessage } from "@/lib/board-messages";
import { dbErrorMessage } from "@/lib/error-message";
import { UNDO_WINDOW_MS } from "@/lib/key-undo";
import { useCanWrite } from "@/lib/role";
import { useRooms } from "@/lib/rooms";
import { createClient } from "@/lib/supabase/client";
import { useLiveRefresh } from "@/lib/use-live-refresh";
import { formatAsTokyoTime, formatDateLabel } from "@/lib/time";
import { showToast } from "@/lib/toast";
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
  carriedRows = [],
}: {
  today: DateString;
  /** 今日、公開済み slots が1件以上ある部屋 */
  roomIds: number[];
  initialRows: RoomStatusRow[];
  /** 今日の連絡 (§6.1.3 / v1.27) */
  initialMessages: BoardMessage[];
  currentUserId: string;
  /** 前日に「開いている」のまま終わり、今日まだ報告の無い部屋 (v1.50.4) */
  carriedRows?: RoomStatusRow[];
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
  const canWrite = useCanWrite();

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
  async function toggle(roomId: number, current: boolean, undo = false) {
    setPendingRoomId(roomId);
    setError(null);

    const res = await fetch("/api/room-status", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ roomId, isUnlocked: !current, undo }),
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
    // 押し間違いは8秒以内なら戻せる (v1.50.4)。通知はサーバーがそのあいだ待つ
    if (!undo) {
      showToast(current ? "閉めたと報告しました" : "開けたと報告しました", {
        durationMs: UNDO_WINDOW_MS,
        action: { label: "取り消す", run: () => void toggle(roomId, !current, true) },
      });
    }
  }

  const rooms = allRooms.filter((room) => roomIds.includes(room.id));

  if (rooms.length === 0) {
    return (
      <section className="rounded-2xl bg-[var(--cell)] p-3" data-tour="room-board">
        <h2 className="text-[17px] font-bold">{formatDateLabel(today)}</h2>
        <p className="mt-1 text-[15px] text-[var(--muted)]">
          今日使う練習場所はありません
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
        <h2 className="text-[17px] font-bold">{formatDateLabel(today)}</h2>
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
        <p role="alert" className="mt-1 text-[13px] text-[var(--danger-fg)]">
          {error}
        </p>
      ) : null}

      <ul className="mt-3 space-y-2">
        {rooms.map((room) => {
          // 今日の報告が無ければ、前日から開いたままの行を使う (v1.50.4)
          const carried = byRoomId.has(room.id)
            ? null
            : (carriedRows.find((r) => r.room_id === room.id) ?? null);
          const row = byRoomId.get(room.id) ?? carried ?? undefined;
          // 行が無い = 未設定。UI 上は × (施錠中) を既定とする
          const unlocked = row?.is_unlocked ?? false;
          const stale =
            !carried &&
            unlocked &&
            row != null &&
            Date.now() - new Date(row.updated_at).getTime() >
              STALE_THRESHOLD_MS;

          return (
            <li key={room.id}>
              {/*
                閲覧のみ (v1.30) は押せないだけで、**薄くはしない**。
                ○× は見るために置いているので、読みにくくなっては意味が無い
              */}
              <button
                type="button"
                onClick={() =>
                  setConfirming({ roomId: room.id, name: room.name, unlock: !unlocked })
                }
                // 閲覧のみ (v1.30) は押せない。状態は読めるよう薄くしない
                disabled={!canWrite || pendingRoomId === room.id}
                aria-label={
                  canWrite
                    ? `${room.name} を${unlocked ? "施錠中" : "開錠済"}に切り替える`
                    : `${room.name}: ${unlocked ? "開錠済" : "施錠中"}`
                }
                aria-pressed={unlocked}
                className={`flex min-h-[64px] w-full items-center gap-3 rounded-xl border-2 px-3 py-2.5 text-left transition-colors active:opacity-70 disabled:cursor-default ${
                  unlocked
                    ? "border-[var(--success-fg)] bg-[var(--success-bg)]"
                    : "border-transparent bg-[var(--background)]"
                } ${stale ? "opacity-60" : ""} ${pendingRoomId === room.id ? "opacity-40" : ""}`}
              >
                {/* 状態は錠前の絵で示す (v1.50.4)。開いていれば、つるの外れた錠前を緑の丸に */}
                <LockBadge unlocked={unlocked} />
                {/* 1列にして、部屋と開けた人の名前は切らずに折り返す (v1.50.4) */}
                <span className="flex min-w-0 flex-1 flex-col gap-0.5">
                  <span className="break-words text-[16px] font-semibold leading-snug">
                    {room.name}
                  </span>
                  <span className="flex flex-wrap items-baseline gap-x-2 text-[13px] leading-snug">
                    <span
                      className={`shrink-0 font-semibold ${
                        unlocked ? "text-[var(--success-fg)]" : "text-[var(--muted)]"
                      }`}
                    >
                      {carried ? "前日から開いたまま" : unlocked ? "開いている" : "閉まっている"}
                    </span>
                    {unlocked && row ? (
                      <span className="break-words text-[var(--muted)]">
                        {carried ? "前日 " : ""}
                        {formatAsTokyoTime(row.updated_at)} {row.profiles?.username ?? ""}
                        {stale ? " (古いかも)" : ""}
                      </span>
                    ) : null}
                  </span>
                </span>
              </button>
            </li>
          );
        })}
      </ul>

      {confirming ? (
        <ReportSheet
          name={confirming.name}
          unlock={confirming.unlock}
          onClose={() => setConfirming(null)}
          onReport={() => {
            const { roomId, unlock } = confirming;
            setConfirming(null);
            void toggle(roomId, !unlock);
          }}
        />
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

/**
 * 開け閉めの報告の窓 (v1.50.4)。真ん中の大きな丸い鍵のボタン1つで、今の状態を出す
 * (閉まっている = 黒・閉じた錠前、開いている = 緑・開いた錠前)。押すと絵が入れ替わり、
 * 入れ替わりを見せてから報告する。文字だけの窓では何が起きるか分かりにくかった
 */
function ReportSheet({
  name,
  unlock,
  onClose,
  onReport,
}: {
  name: string;
  /** 報告したあとの状態。true = 開けた */
  unlock: boolean;
  onClose: () => void;
  onReport: () => void;
}) {
  const [pressed, setPressed] = useState(false);
  // 親が描き直しても待ちを始め直さないよう、最新の関数は ref で持つ
  const report = useRef(onReport);
  report.current = onReport;
  useEffect(() => {
    if (!pressed) return;
    const timer = window.setTimeout(() => report.current(), 450);
    return () => window.clearTimeout(timer);
  }, [pressed]);
  // 押す前は今の状態、押したあとは報告したあとの状態
  const showUnlocked = pressed ? unlock : !unlock;

  return (
    <Sheet title={name} onClose={onClose}>
      <div className="flex flex-col items-center gap-4 pb-2 pt-3">
        <button
          type="button"
          disabled={pressed}
          onClick={() => setPressed(true)}
          aria-label={unlock ? `${name}を開けたと報告する` : `${name}を閉めたと報告する`}
          className={`grid h-32 w-32 place-items-center rounded-full text-white shadow-[0_10px_30px_-12px_rgba(0,0,0,0.45)] transition-[background-color,transform] duration-300 active:scale-95 ${
            showUnlocked ? "bg-[var(--success-fg)]" : "bg-[var(--foreground)]"
          }`}
        >
          <LockIcon unlocked={showUnlocked} size={52} />
        </button>
        <p className="text-[17px] font-semibold">{unlock ? "開けたと報告" : "閉めたと報告"}</p>
        <p className="text-[14px] text-[var(--muted)]">現役全員に通知が届きます。</p>
      </div>
    </Sheet>
  );
}

/** 錠前の絵 (v1.50.4)。開いている = つるが外れて緑、閉まっている = 閉じて灰色 */
function LockBadge({ unlocked }: { unlocked: boolean }) {
  return (
    <span
      aria-hidden
      className={`grid h-11 w-11 shrink-0 place-items-center rounded-full transition-colors ${
        unlocked ? "bg-[var(--success-fg)] text-white" : "bg-[var(--fill)] text-[var(--muted)]"
      }`}
    >
      <LockIcon unlocked={unlocked} size={22} />
    </span>
  );
}

function LockIcon({ unlocked, size }: { unlocked: boolean; size: number }) {
  return (
    <svg
      aria-hidden
      viewBox="0 0 24 24"
      width={size}
      height={size}
      fill="none"
      stroke="currentColor"
      strokeWidth="2.2"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <rect x="4.5" y="10.5" width="15" height="10" rx="2.5" fill="currentColor" stroke="none" />
      {/* つる。開いているときは右の足を上げて外す */}
      <path d={unlocked ? "M8 10.5V7a4 4 0 0 1 7.6-1.7" : "M8 10.5V7a4 4 0 0 1 8 0v3.5"} />
    </svg>
  );
}
