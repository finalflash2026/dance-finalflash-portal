"use client";

import { useState } from "react";

import { createClient } from "@/lib/supabase/client";
import { formatAsTokyoTime } from "@/lib/time";
import type { NotificationType } from "@/lib/types";

/**
 * お知らせカード (SPEC.md §6.4-2)
 *
 * 新しい順。未読は強調し、タップで既読化する (`read_at` 更新)。
 * 生成はすべて DB のトリガとサーバー側で行うので、ここでは読み書きしかしない。
 * RLS は本人分の select/update しか許さない (`sel_notif` / `upd_notif`)。
 */

export interface NotificationRow {
  id: string;
  type: NotificationType;
  title: string;
  body: string | null;
  createdAt: string;
  readAt: string | null;
}

const TYPE_LABELS: Record<NotificationType, string> = {
  number_added: "ナンバー",
  schedule_updated: "練習日程",
  attendance_updated: "出欠",
};

export function NotificationList({
  initial,
}: {
  initial: NotificationRow[];
}) {
  const [rows, setRows] = useState(initial);
  const [expanded, setExpanded] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const unread = rows.filter((row) => row.readAt === null).length;
  // 既定は3件だけ。お知らせで画面が埋まると下のカレンダーが遠くなる
  const shown = expanded ? rows : rows.slice(0, 3);

  async function markRead(row: NotificationRow) {
    if (row.readAt !== null) return;

    // 先に画面を更新する。既読化は失敗しても実害が無く、
    // タップのたびに待たされるほうが体感で損なため
    const readAt = new Date().toISOString();
    setRows((prev) =>
      prev.map((r) => (r.id === row.id ? { ...r, readAt } : r)),
    );

    const supabase = createClient();
    const { error: updateError } = await supabase
      .from("notifications")
      .update({ read_at: readAt })
      .eq("id", row.id);

    if (updateError) {
      setError(`既読にできませんでした: ${updateError.message}`);
      setRows((prev) =>
        prev.map((r) => (r.id === row.id ? { ...r, readAt: null } : r)),
      );
    }
  }

  if (rows.length === 0) return null;

  return (
    <section className="space-y-1">
      <h2 className="text-sm font-bold">
        お知らせ
        {unread > 0 ? (
          <span className="ml-1 rounded-full bg-[#C0392B] px-1.5 text-[10px] font-bold text-white">
            {unread}
          </span>
        ) : null}
      </h2>

      {error ? (
        <p role="alert" className="text-xs text-[#8B1A10]">
          {error}
        </p>
      ) : null}

      <ul className="divide-y divide-[var(--border)] rounded-xl border border-[var(--border)]">
        {shown.map((row) => {
          const isUnread = row.readAt === null;
          return (
            <li key={row.id}>
              <button
                type="button"
                onClick={() => markRead(row)}
                className={`flex w-full items-start gap-2 px-3 py-2 text-left ${
                  isUnread ? "" : "opacity-60"
                }`}
              >
                <span
                  aria-hidden
                  className={`mt-1.5 h-1.5 w-1.5 shrink-0 rounded-full ${
                    isUnread ? "bg-[#C0392B]" : "bg-transparent"
                  }`}
                />
                <span className="min-w-0 flex-1">
                  <span
                    className={`block text-sm ${isUnread ? "font-medium" : ""}`}
                  >
                    {row.title}
                  </span>
                  {row.body ? (
                    <span className="block text-xs text-[var(--muted)]">
                      {row.body}
                    </span>
                  ) : null}
                  <span className="block text-[10px] text-[var(--muted)]">
                    {TYPE_LABELS[row.type]} / {formatAsTokyoTime(row.createdAt)}
                  </span>
                </span>
              </button>
            </li>
          );
        })}
      </ul>

      {rows.length > 3 ? (
        <button
          type="button"
          onClick={() => setExpanded((prev) => !prev)}
          className="w-full py-1 text-xs text-[var(--muted)]"
        >
          {expanded ? "たたむ" : `すべて表示 (${rows.length}件)`}
        </button>
      ) : null}
    </section>
  );
}
