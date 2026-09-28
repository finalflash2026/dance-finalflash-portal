"use client";

import { useCallback, useEffect, useRef, useState } from "react";

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

/**
 * キーボードが出ている間の「見えている範囲」を返す (v1.29.4)
 *
 * iOS でキーボードが出ると、**表示領域 (visual viewport) だけが縮んで
 * 上にずれる**。`position: fixed` はページ側の座標に貼り付くので、
 * 画面上では窓ごと上へ滑っていき、入力欄はキーボードから遠いところに残る。
 *
 * そこで**見えている範囲そのものに窓を合わせる**。上端と高さを毎回もらって
 * 貼り直せば、入力欄はキーボードのすぐ上に来て、窓が勝手に動かなくなる。
 *
 * visualViewport が無い環境では null を返し、これまでどおり画面いっぱいに置く。
 */
function useVisibleArea(active: boolean): { top: number; height: number } | null {
  const [area, setArea] = useState<{ top: number; height: number } | null>(null);

  useEffect(() => {
    const viewport = active ? window.visualViewport : null;
    if (!viewport) {
      setArea(null);
      return;
    }
    const update = () =>
      setArea({ top: viewport.offsetTop, height: viewport.height });
    update();
    viewport.addEventListener("resize", update);
    viewport.addEventListener("scroll", update);
    return () => {
      viewport.removeEventListener("resize", update);
      viewport.removeEventListener("scroll", update);
    };
  }, [active]);

  return area;
}

/**
 * 打った内容に合わせて入力欄を伸ばす。
 *
 * **一度 auto に戻してから測る。** 前の高さが残っていると scrollHeight が
 * それ以上に縮まず、文字を消しても細くならない。
 * 上限は CSS (`max-h-32`) 側で止めて、その先は中でスクロールさせる。
 */
function autosize(element: HTMLTextAreaElement) {
  element.style.height = "auto";
  element.style.height = `${element.scrollHeight}px`;
}

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
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const listRef = useRef<HTMLDivElement>(null);
  const visibleArea = useVisibleArea(open);

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

  // 開いたら最新の連絡まで送る。古い順に並べているので、下が今の話
  useEffect(() => {
    if (!open || !listRef.current) return;
    listRef.current.scrollTop = listRef.current.scrollHeight;
  }, [open]);

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
    // 伸ばした高さも戻す。戻さないと空欄のまま数行ぶん空く
    if (inputRef.current) {
      inputRef.current.style.height = "auto";
      inputRef.current.focus();
    }
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
          className="fixed inset-x-0 top-0 z-50 flex h-[100dvh] items-end justify-center sm:items-center"
          style={visibleArea ?? undefined}
        >
          <div
            className="backdrop-in absolute inset-0 bg-black/40"
            onClick={() => setOpen(false)}
          />
          <div
            role="dialog"
            aria-modal="true"
            aria-label="連絡"
            /*
              **高さを先に決める** (v1.29.3)。中身なりに伸ばすと、連絡が
              0〜2件のときに窓が指1本ぶんの高さしかなく、開いたことすら
              分かりにくかった。読む場所を先に確保しておく
            */
            className="sheet-in relative z-10 flex h-[54dvh] max-h-full w-full max-w-md flex-col rounded-t-2xl bg-[var(--background)] sm:h-[58vh] sm:rounded-2xl"
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

            <div
              ref={listRef}
              className="min-h-0 flex-1 space-y-2 overflow-y-auto px-4 py-3"
            >
              {messages.length === 0 ? (
                <p className="flex h-full items-center justify-center text-sm text-[var(--muted)]">
                  連絡はまだありません
                </p>
              ) : (
                messages.map((message) => {
                  const mine = message.userId === currentUserId;
                  return (
                    <div
                      key={message.id}
                      className={`flex flex-col ${mine ? "items-end" : "items-start"}`}
                    >
                      {/* 自分の名前は出さない。右にあること自体が「自分」の印 */}
                      {mine ? null : (
                        <span className="max-w-full truncate px-1 text-[11px] text-[var(--muted)]">
                          {message.username}
                        </span>
                      )}

                      {/* 自分のぶんは並びを反転させ、時刻と削除を吹き出しの左に置く */}
                      <div
                        className={`flex max-w-[85%] items-end gap-1 ${mine ? "flex-row-reverse" : ""}`}
                      >
                        <p
                          className={`min-w-0 whitespace-pre-wrap break-words rounded-2xl px-3 py-2 text-sm ${
                            mine ? "rounded-br-sm" : "rounded-bl-sm"
                          }`}
                          style={{
                            background: mine
                              ? "var(--bubble-mine-bg)"
                              : "var(--bubble-bg)",
                          }}
                        >
                          {message.body}
                        </p>
                        <span className="shrink-0 pb-0.5 text-[10px] text-[var(--muted)]">
                          {scope === "room"
                            ? formatAsTokyoTime(message.createdAt)
                            : formatAsTokyoDateTime(message.createdAt)}
                        </span>
                        {/* 消せるのは書いた本人だけ。RLS も同じ条件 */}
                        {mine ? (
                          <button
                            type="button"
                            disabled={pending}
                            onClick={() => remove(message)}
                            className="shrink-0 pb-0.5 text-[10px] text-[var(--danger-fg)] underline"
                          >
                            削除
                          </button>
                        ) : null}
                      </div>
                    </div>
                  );
                })
              )}
            </div>

            {/*
              `safe-bottom` はホームバーのぶんの余白 (globals.css)。
              この窓は下のボタンを固定していて**スクロールでも逃げられない**ので、
              入れ忘れると「書き込む」が押しにくいままになる
            */}
            <div className="safe-bottom space-y-1.5 border-t border-[var(--border)] px-3 py-2">
              <div className="flex items-end gap-2">
                {/*
                  **1行で始めて、打つぶんだけ伸ばす** (v1.29.3)。
                  連絡はたいてい一言なので、最初から数行ぶんの箱を空けて
                  おくと読む場所が削られる。伸びる上限は5行ぶんで、
                  それ以上は中でスクロールさせる
                */}
                <div className="flex min-w-0 flex-1 items-end gap-1 rounded-2xl border border-[var(--border)] bg-[var(--background)] px-3 py-1.5 focus-within:border-[var(--foreground)]">
                  <textarea
                    ref={inputRef}
                    aria-label="連絡の内容"
                    value={draft}
                    rows={1}
                    maxLength={MESSAGE_MAX_LENGTH}
                    disabled={pending}
                    placeholder="メッセージを入力"
                    onChange={(e) => {
                      setDraft(e.target.value);
                      autosize(e.target);
                    }}
                    onKeyDown={(e) => {
                      // パソコンから打つ人向け。改行は素の Enter のまま
                      if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) {
                        e.preventDefault();
                        void send();
                      }
                    }}
                    className="max-h-32 min-w-0 flex-1 resize-none bg-transparent py-1 text-base leading-6 outline-none"
                  />
                  <button
                    type="button"
                    onClick={send}
                    disabled={pending || draft.trim().length === 0}
                    aria-label={pending ? "送信中" : "送信"}
                    title="送信"
                    className="mb-0.5 shrink-0 rounded-full p-1 text-[var(--foreground)] disabled:text-[var(--muted)] disabled:opacity-40"
                  >
                    <SendIcon />
                  </button>
                </div>

                {/* 閉じるは入力欄の外。送信と並べても取り違えないよう形を変える */}
                <button
                  type="button"
                  onClick={() => setOpen(false)}
                  aria-label="閉じる"
                  title="閉じる"
                  className="mb-0.5 shrink-0 rounded-full border border-[var(--border)] p-2 text-[var(--muted)]"
                >
                  <CloseIcon />
                </button>
              </div>

              {/*
                文字数は**上限が近いときだけ**出す。常に出しておくと、
                一言を書くだけの欄に毎回ついてまわって場所を取る
              */}
              {draft.length >= MESSAGE_MAX_LENGTH - 50 ? (
                <p className="px-1 text-right text-[11px] text-[var(--muted)]">
                  {draft.length}/{MESSAGE_MAX_LENGTH}
                </p>
              ) : null}
            </div>
          </div>
        </div>
      ) : null}
    </>
  );
}

/** 送信。紙飛行機は「送る」の意味がいちばん通じる形 */
function SendIcon() {
  return (
    <svg
      width="20"
      height="20"
      viewBox="0 0 20 20"
      fill="currentColor"
      aria-hidden
    >
      <path d="M2.2 17.3 18.5 10 2.2 2.7l.01 5.68L13.5 10 2.21 11.62z" />
    </svg>
  );
}

/** 閉じる。設定の × と同じ絵にして、意味を揃える */
function CloseIcon() {
  return (
    <svg
      width="14"
      height="14"
      viewBox="0 0 14 14"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      aria-hidden
    >
      <line x1="1" y1="1" x2="13" y2="13" />
      <line x1="13" y1="1" x2="1" y2="13" />
    </svg>
  );
}
