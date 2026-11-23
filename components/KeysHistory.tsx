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
 * 練習場所は開け閉め (room_status_logs)、部室の鍵は受け渡し (club_key_holders) を
 * 新しい順に10件ずつ出す。連絡は「連絡」の窓で見られるので混ぜない。
 */

const PAGE = 10;

interface Item {
  key: string;
  at: string;
  who: string;
  what: string;
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
      const column = kind === "room" ? "created_at" : "taken_at";

      const base =
        kind === "room"
          ? supabase
              .from("room_status_logs")
              .select("id, room_id, is_unlocked, created_at, profiles(username)")
          : supabase.from("club_key_holders").select("id, taken_at, profiles(username)");
      const ordered = base.order(column, { ascending: false }).limit(PAGE);
      const result = await (before ? ordered.lt(column, before) : ordered);

      // 開け閉めの表が無い DB (0031 前) では、記録が無いのと同じに出す
      if (result.error && !isMissingRelation(result.error)) {
        setError(dbErrorMessage("記録を読めませんでした", result.error));
        setLoading(false);
        return;
      }

      const rows = (result.error ? [] : (result.data ?? [])) as unknown as {
        id: string | number;
        room_id?: number;
        is_unlocked?: boolean;
        created_at?: string;
        taken_at?: string;
        profiles: { username: string } | null;
      }[];
      const page: Item[] = rows
        .map((row) => ({
          key: String(row.id),
          at: (row.created_at ?? row.taken_at)!,
          who: row.profiles?.username ?? "(退会したユーザー)",
          what:
            kind === "room"
              ? `${roomName.get(row.room_id!) ?? "練習場所"}を${row.is_unlocked ? "開けた" : "閉めた"}`
              : "受け取った",
        }))
        // デモのクライアントは lt を当てないので、ここでも絞る
        .filter((item) => !before || item.at < before)
        .slice(0, PAGE);

      setItems((prev) => (before ? [...prev, ...page] : page));
      setMore(rows.length === PAGE);
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
                <span className="break-words text-[var(--muted)]"> が{item.what}</span>
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
