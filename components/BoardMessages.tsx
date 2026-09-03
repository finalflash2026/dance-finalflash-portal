"use client";

import { useCallback, useEffect, useState } from "react";

import {
  MESSAGE_MAX_LENGTH,
  toBoardMessages,
  type BoardMessage,
} from "@/lib/board-messages";
import { createClient } from "@/lib/supabase/client";
import { formatAsTokyoDateTime, formatAsTokyoTime } from "@/lib/time";
import { useLiveRefresh } from "@/lib/use-live-refresh";

/**
 * 掲示板の連絡欄 (SPEC.md §6.1.3 / v1.27)
 *
 * ○×だけでは表せない状況を短く書き残す欄。
 * 「控室136は開けていないが、鍵はリハーサル室にいる人が持っている」など。
 *
 * **ボードの中には1行しか置かない。** 全体カレンダーには施錠ボード・
 * 部室の鍵・ミニカレンダー・日別ビューが縦に並んでいて、ここに会話を
 * 直接展開すると**カレンダーが画面外へ押し出される**。件数と最新の1件だけ
 * 見せて、読み書きは下から出る窓に寄せる (申請シートや出欠と同じ形)。
 *
 * 書き換えはできない (追加と削除だけ)。言った内容が後から変わると、
 * 読んだ人の記憶と食い違う。
 */

/** ボードと同じ間隔で見直す (§6.1.1) */
const POLL_INTERVAL_MS = 15_000;

export function BoardMessages({
  scope,
  date,
  initialMessages,
  currentUserId,
}: {
  scope: "room" | "club_key";
  /** scope='room' のときの対象日。club_key は日付を持たない */
  date: string | null;
  initialMessages: BoardMessage[];
  currentUserId: string;
}) {
  const [messages, setMessages] = useState(initialMessages);
  const [open, setOpen] = useState(false);
  const [draft, setDraft] = useState("");
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    const supabase = createClient();
    let query = supabase
      .from("board_messages")
      .select("id, body, user_id, created_at, profiles(username)")
      .eq("scope", scope)
      .order("created_at", { ascending: true });
    query = date === null ? query.is("date", null) : query.eq("date", date);

    const { data, error: fetchError } = await query;
    if (fetchError) {
      setError(`連絡を取得できませんでした: ${fetchError.message}`);
      return;
    }
    setError(null);
    setMessages(toBoardMessages(data));
  }, [scope, date]);

  useLiveRefresh(refresh, POLL_INTERVAL_MS);

  // 窓を開けている間は閉じるまで Esc で戻れるようにする (他のシートと同じ)
  useEffect(() => {
    if (!open) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") setOpen(false);
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [open]);

  async function send() {
    const body = draft.trim();
    if (!body) return;
    setPending(true);
    setError(null);

    // **API 経由** (§6.6)。全員に通知が飛ぶ操作なので、ブラウザから
    // 直接 insert させると書いていない内容を届けられてしまう
    const res = await fetch("/api/board-messages", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ scope, body }),
    });
    setPending(false);

    if (!res.ok) {
      const data = (await res.json().catch(() => null)) as {
        error?: string;
      } | null;
      setError(data?.error ?? "書き込めませんでした");
      return;
    }
    setDraft("");
    await refresh();
  }

  async function remove(message: BoardMessage) {
    if (!window.confirm("この連絡を削除しますか?")) return;
    setPending(true);
    setError(null);
    const supabase = createClient();
    // 削除は通知を伴わないので RLS 経由で直接消してよい (本人だけ許可)
    const { error: deleteError } = await supabase
      .from("board_messages")
      .delete()
      .eq("id", message.id);
    setPending(false);
    if (deleteError) {
      setError(`削除できませんでした: ${deleteError.message}`);
      return;
    }
    await refresh();
  }

  const latest = messages.at(-1) ?? null;

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="mt-1.5 flex w-full items-center gap-1.5 rounded-lg border border-[var(--border)] px-2 py-1 text-left text-[11px]"
      >
        {/*
          0件のときは「連絡」と本文を分けず1つの文にする。
          分けたままだと「連絡 はまだありません」と隙間が空いて読みにくい
        */}
        {latest ? (
          <>
            <span className="shrink-0 font-bold">連絡 {messages.length}件</span>
            <span className="min-w-0 flex-1 truncate text-[var(--muted)]">
              {latest.username}: {latest.body}
            </span>
          </>
        ) : (
          <span className="min-w-0 flex-1 truncate text-[var(--muted)]">
            連絡はまだありません
          </span>
        )}
        <span aria-hidden className="shrink-0 text-[var(--muted)]">
          ›
        </span>
      </button>

      {open ? (
        <div
          data-no-swipe
          className="fixed inset-0 z-50 flex items-end justify-center sm:items-center"
        >
          <div
            className="backdrop-in absolute inset-0 bg-black/40"
            onClick={() => setOpen(false)}
          />
          <div
            role="dialog"
            aria-modal="true"
            aria-label="連絡"
            className="sheet-in relative z-10 flex max-h-[85dvh] w-full max-w-md flex-col rounded-t-2xl bg-[var(--background)] sm:rounded-2xl"
          >
            <header className="flex items-baseline justify-between gap-2 border-b border-[var(--border)] px-4 py-3">
              <h3 className="text-base font-bold">
                {scope === "room" ? "今日の練習場所の連絡" : "部室の鍵の連絡"}
              </h3>
              <span className="text-xs text-[var(--muted)]">
                {messages.length}件
              </span>
            </header>

            {error ? (
              <p
                role="alert"
                className="px-4 pt-2 text-xs text-[var(--danger-fg)]"
              >
                {error}
              </p>
            ) : null}

            <div className="min-h-0 flex-1 space-y-2 overflow-y-auto px-4 py-3">
              {messages.length === 0 ? (
                <p className="py-6 text-center text-sm text-[var(--muted)]">
                  連絡はまだありません
                </p>
              ) : (
                messages.map((message) => (
                  <div
                    key={message.id}
                    className="rounded-lg bg-[var(--surface)] px-3 py-2"
                  >
                    <div className="flex items-baseline gap-2">
                      <span className="min-w-0 flex-1 truncate text-xs font-bold">
                        {message.username}
                      </span>
                      <span className="shrink-0 text-[10px] text-[var(--muted)]">
                        {scope === "room"
                          ? formatAsTokyoTime(message.createdAt)
                          : formatAsTokyoDateTime(message.createdAt)}
                      </span>
                      {/* 消せるのは書いた本人だけ。RLS も同じ条件 */}
                      {message.userId === currentUserId ? (
                        <button
                          type="button"
                          disabled={pending}
                          onClick={() => remove(message)}
                          className="shrink-0 text-[10px] text-[var(--danger-fg)] underline"
                        >
                          削除
                        </button>
                      ) : null}
                    </div>
                    <p className="mt-0.5 whitespace-pre-wrap break-words text-sm">
                      {message.body}
                    </p>
                  </div>
                ))
              )}
            </div>

            {/*
              下端は**ホームバーのぶんだけ余分に空ける**。ホーム画面から開くと
              画面の隅まで自前で描く設定 (viewport-fit=cover) になっていて、
              一番下に置いたものは iPhone のホームバーの下に潜る。
              この窓は下のボタンを固定しているのでスクロールでも逃げられず、
              「書き込む」が押しにくいままになっていた。
            */}
            <div className="space-y-2 border-t border-[var(--border)] px-4 pt-3 pb-[calc(env(safe-area-inset-bottom)+1rem)]">
              <textarea
                aria-label="連絡の内容"
                value={draft}
                rows={2}
                maxLength={MESSAGE_MAX_LENGTH}
                disabled={pending}
                placeholder="メッセージを入力"
                onChange={(e) => setDraft(e.target.value)}
                className="w-full resize-none rounded-lg border border-[var(--border)] bg-[var(--background)] px-3 py-2 text-base outline-none focus:border-[var(--foreground)]"
              />
              <p className="text-[11px] text-[var(--muted)]">
                書き込むと現役全員に通知が届きます ({draft.length}/{MESSAGE_MAX_LENGTH})
              </p>
              <div className="flex gap-2">
                <button
                  type="button"
                  onClick={send}
                  disabled={pending || draft.trim().length === 0}
                  className="flex-1 rounded-lg bg-[var(--primary)] px-4 py-2.5 text-sm font-bold text-[var(--primary-fg)] disabled:opacity-50"
                >
                  {pending ? "送信中…" : "書き込む"}
                </button>
                <button
                  type="button"
                  onClick={() => setOpen(false)}
                  className="rounded-lg border border-[var(--border)] px-4 py-2.5 text-sm"
                >
                  閉じる
                </button>
              </div>
            </div>
          </div>
        </div>
      ) : null}
    </>
  );
}
