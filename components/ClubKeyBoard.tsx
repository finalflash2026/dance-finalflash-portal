"use client";

import { useCallback, useState } from "react";

import {
  KEY_HISTORY_LIMIT,
  toKeyHolderRows,
  type KeyHolderRow,
} from "@/lib/club-key";
import { BoardMessages } from "@/components/BoardMessages";
import type { BoardMessage } from "@/lib/board-messages";
import { createClient } from "@/lib/supabase/client";
import { useLiveRefresh } from "@/lib/use-live-refresh";
import { formatAsTokyoDateTime } from "@/lib/time";

/**
 * 「部室の鍵の所持」ボード (SPEC.md §6.1.2)
 *
 * 部室の鍵は1本しかなく手渡しで回っているので、今どこにあるかを共有する。
 * **受け取った人がボタンを押すだけ**で所持者が変わる。渡す側の操作も要ると、
 * 片方が忘れた時点で表示が止まってしまうため。
 *
 * 記録は1行を書き換えるのではなく**受け渡しのたびに1行足す**。
 * 履歴が残って行方をたどれるうえ、同時操作の競合を考えなくてよい。
 * 施錠状況ボード (§6.1.1) と違い**日付でリセットしない** —
 * 鍵は日をまたいで同じ人が持っているのが普通なので。
 */

/** 施錠状況ボードと同じ間隔で見直す。**15秒** (SPEC §6.1.1 / v1.14) */
const POLL_INTERVAL_MS = 15_000;

export function ClubKeyBoard({
  initialRows,
  currentUserId,
  initialMessages,
}: {
  /** 新しい順。先頭が現在の所持者 */
  initialRows: KeyHolderRow[];
  currentUserId: string;
  /** 部室の鍵についての連絡 (§6.1.3 / v1.27)。日付では区切らない */
  initialMessages: BoardMessage[];
}) {
  const [rows, setRows] = useState(initialRows);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    const supabase = createClient();
    const { data, error: fetchError } = await supabase
      .from("club_key_holders")
      .select("id, user_id, taken_at, profiles(username)")
      .order("taken_at", { ascending: false })
      .limit(KEY_HISTORY_LIMIT);

    if (fetchError) {
      setError(`最新の状態を取得できませんでした: ${fetchError.message}`);
      return;
    }
    setError(null);
    setRows(toKeyHolderRows(data));
  }, []);

  useLiveRefresh(refresh, POLL_INTERVAL_MS);

  const holder = rows[0] ?? null;
  const isMine = holder?.userId === currentUserId;

  async function claim() {
    if (
      !window.confirm(
        "あなたが部室の鍵を持っていることにします。\n全員の画面に所持者として表示されます。",
      )
    ) {
      return;
    }

    setPending(true);
    setError(null);

    // 登録は **API 経由** (v1.15)。ここから直接 insert していると、
    // 実際には受け取っていない人が「◯◯が鍵を持っています」の通知だけを
    // 全員へ流せてしまう。RLS の「自分の分しか宣言できない」条件は
    // サーバー側でもセッションのクライアントを使うことで効いたままにしてある
    const res = await fetch("/api/club-key/claim", { method: "POST" });

    if (!res.ok) {
      const data = (await res.json().catch(() => null)) as {
        error?: string;
      } | null;
      setPending(false);
      setError(data?.error ?? "登録できませんでした");
      return;
    }

    await refresh();
    setPending(false);
  }

  return (
    <section className="rounded-xl border border-[var(--border)] p-3">
      <h2 className="text-sm font-bold">部室の鍵</h2>

      {error ? (
        <p role="alert" className="mt-1 text-xs text-[var(--danger-fg)]">
          {error}
        </p>
      ) : null}

      <div className="mt-1 flex items-center gap-2">
        <p className="min-w-0 flex-1 text-sm">
          {holder ? (
            <>
              <span className="font-bold">{holder.username}</span>
              {isMine ? (
                <span className="ml-1 text-xs text-[var(--muted)]">(自分)</span>
              ) : null}
              <span className="ml-2 text-xs text-[var(--muted)]">
                {formatAsTokyoDateTime(holder.takenAt)} から
              </span>
            </>
          ) : (
            <span className="text-[var(--muted)]">まだ登録されていません</span>
          )}
        </p>

        {/*
         * ボタンは**すりガラス**にしてある (v1.14.2)。タブバーと同じ質感で、
         * 「押せるもの」であることが枠線よりはっきり出る。角は大きめに丸めて
         * タブバーのピルと揃える。
         *
         * 文言は「所持中に変更」。**今の状態ではなく、押すと何が起きるかを書く。**
         * 「私が持っています」は事実の申告に読め、既に自分が持っている人が
         * 押してよいのか迷う。
         */}
        <button
          type="button"
          onClick={claim}
          disabled={pending || isMine}
          className="glass shrink-0 rounded-2xl px-3.5 py-2 text-xs font-bold disabled:text-[var(--muted)] disabled:opacity-60"
        >
          {isMine ? "自分が所持中" : "所持中に変更"}
        </button>
      </div>

      {rows.length > 1 ? (
        <details className="mt-1">
          <summary className="cursor-pointer text-xs text-[var(--muted)]">
            受け渡しの履歴
          </summary>
          <ul className="mt-1 space-y-0.5">
            {rows.slice(1).map((row) => (
              <li key={row.id} className="text-xs text-[var(--muted)]">
                {formatAsTokyoDateTime(row.takenAt)} {row.username}
              </li>
            ))}
          </ul>
        </details>
      ) : null}

      <BoardMessages
        scope="club_key"
        date={null}
        initialMessages={initialMessages}
        currentUserId={currentUserId}
      />
    </section>
  );
}

