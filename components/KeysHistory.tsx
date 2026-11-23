"use client";

import { useCallback, useEffect, useState } from "react";

import { GroupHeader, groupClass } from "@/components/ui";
import { dbErrorMessage } from "@/lib/error-message";
import { useRooms } from "@/lib/rooms";
import { isMissingRelation } from "@/lib/schema-errors";
import { createClient } from "@/lib/supabase/client";
import { formatAsTokyoDateTime } from "@/lib/time";

/**
 * これまでの記録 (SPEC.md §6.1.1 / v1.50.4)。
 *
 * 練習場所は「開け閉め (room_status_logs) + 連絡 (日をまたいで)」、
 * 部室の鍵は「受け渡し (club_key_holders) + 連絡」を、新しい順に10件ずつ混ぜて出す。
 * 2つの表を混ぜるので、それぞれから10件読んで時刻で並べ、上から10件を出す。
 * 続きは、出した最後の時刻より前をまた10件ずつ読む。
 */

const PAGE = 10;

interface Item {
  key: string;
  at: string;
  who: string;
  what: string;
  /** 連絡の本文。開け閉め・受け渡しには無い */
  body?: string;
}

type Kind = "room" | "club-key";

export function KeysHistory({ kind }: { kind: Kind }) {
  const rooms = useRooms();
  const [items, setItems] = useState<Item[]>([]);
  const [more, setMore] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(
    async (before: string | null) => {
      setLoading(true);
      setError(null);
      const supabase = createClient();
      const roomName = new Map(rooms.map((room) => [room.id, room.name]));

      const events =
        kind === "room"
          ? supabase
              .from("room_status_logs")
              .select("id, room_id, is_unlocked, created_at, profiles(username)")
              .order("created_at", { ascending: false })
              .limit(PAGE)
          : supabase
              .from("club_key_holders")
              .select("id, taken_at, profiles(username)")
              .order("taken_at", { ascending: false })
              .limit(PAGE);
      const messages = supabase
        .from("board_messages")
        .select("id, body, created_at, profiles(username)")
        .eq("scope", kind === "room" ? "room" : "club_key")
        .order("created_at", { ascending: false })
        .limit(PAGE);

      const [eventResult, messageResult] = await Promise.all([
        before ? events.lt(kind === "room" ? "created_at" : "taken_at", before) : events,
        before ? messages.lt("created_at", before) : messages,
      ]);
      // 開け閉めの表が無い DB (0031 前) では、連絡だけ出す
      const eventError = isMissingRelation(eventResult.error) ? null : eventResult.error;
      if (eventError || messageResult.error) {
        setError(dbErrorMessage("記録を読めませんでした", (eventError ?? messageResult.error)!));
        setLoading(false);
        return;
      }

      const eventRows = (eventResult.error ? [] : (eventResult.data ?? [])) as unknown as {
        id: string | number;
        room_id?: number;
        is_unlocked?: boolean;
        created_at?: string;
        taken_at?: string;
        profiles: { username: string } | null;
      }[];
      const messageRows = (messageResult.data ?? []) as unknown as {
        id: string;
        body: string;
        created_at: string;
        profiles: { username: string } | null;
      }[];

      const fetched: Item[] = [
        ...eventRows.map((row) => ({
          key: `e-${row.id}`,
          at: (row.created_at ?? row.taken_at)!,
          who: row.profiles?.username ?? "(退会したユーザー)",
          what:
            kind === "room"
              ? `${roomName.get(row.room_id!) ?? "練習場所"}を${row.is_unlocked ? "開けた" : "閉めた"}`
              : "部室の鍵を受け取った",
        })),
        ...messageRows.map((row) => ({
          key: `m-${row.id}`,
          at: row.created_at,
          who: row.profiles?.username ?? "(退会したユーザー)",
          what: "連絡",
          body: row.body,
        })),
      ]
        .filter((item) => !before || item.at < before)
        .sort((a, b) => b.at.localeCompare(a.at));

      const page = fetched.slice(0, PAGE);
      setItems((prev) => (before ? [...prev, ...page] : page));
      // どちらかの表がまだ10件ぶん返してきたか、混ぜて余ったなら続きがある
      setMore(
        fetched.length > PAGE || eventRows.length === PAGE || messageRows.length === PAGE,
      );
      setLoading(false);
    },
    [kind, rooms],
  );

  useEffect(() => {
    void load(null);
  }, [load]);

  return (
    <section>
      <GroupHeader>これまでの記録</GroupHeader>
      {error ? (
        <p role="alert" className="px-1 pb-2 text-[13px] text-[var(--danger-fg)]">
          {error}
        </p>
      ) : null}
      {items.length === 0 && !loading && !error ? (
        <p className={`${groupClass} px-4 py-3 text-[15px] text-[var(--muted)]`}>
          記録はまだありません
        </p>
      ) : (
        <ul className={groupClass}>
          {items.map((item) => (
            <li key={item.key} className="flex gap-3 px-4 py-2.5">
              <span className="w-[44px] shrink-0 pt-px text-[13px] leading-snug text-[var(--muted)] tabular-nums">
                {formatAsTokyoDateTime(item.at)}
              </span>
              <span className="min-w-0 flex-1 text-[15px] leading-snug">
                <span className="break-words font-semibold">{item.who}</span>
                <span className="break-words text-[var(--muted)]">
                  {item.body ? " の連絡" : ` が${item.what}`}
                </span>
                {item.body ? (
                  <span className="mt-0.5 block whitespace-pre-wrap break-words">{item.body}</span>
                ) : null}
              </span>
            </li>
          ))}
        </ul>
      )}
      {more ? (
        <button
          type="button"
          disabled={loading}
          onClick={() => void load(items[items.length - 1]?.at ?? null)}
          className="mt-2 h-11 w-full rounded-xl text-[15px] font-semibold text-[var(--tint)] active:opacity-60 disabled:opacity-40"
        >
          さらに10件
        </button>
      ) : null}
    </section>
  );
}
