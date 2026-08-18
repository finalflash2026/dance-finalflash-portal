"use client";

import { useState } from "react";

import { createClient } from "@/lib/supabase/client";
import { formatAsTokyoTime } from "@/lib/time";
import type { NotificationType } from "@/lib/types";

/**
 * お知らせカード (SPEC.md §6.4-2 / v1.10)
 *
 * **未読だけを新しい順に出し、タップで既読にしたらリストから消す。**
 * 既読が淡色で残り続けると、その下のカレンダーが遠くなるだけで読む価値が無い。
 * 未読が0件ならカードごと出さない。
 *
 * 生成はすべて DB のトリガとサーバー側で行うので、ここでは読み書きしかしない。
 * RLS は本人分の select/update しか許さない (`sel_notif` / `upd_notif`)。
 */

/** サーバーからは**未読だけ**が渡ってくる (既読は画面に出さないため) */
export interface NotificationRow {
  id: string;
  type: NotificationType;
  title: string;
  body: string | null;
  createdAt: string;
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
  const [error, setError] = useState<string | null>(null);

  async function markRead(row: NotificationRow) {
    // 先に画面から消す。既読化は失敗しても実害が無く、
    // タップのたびに待たされるほうが体感で損なため
    setRows((prev) => prev.filter((r) => r.id !== row.id));

    const supabase = createClient();
    const { error: updateError } = await supabase
      .from("notifications")
      .update({ read_at: new Date().toISOString() })
      .eq("id", row.id);

    if (updateError) {
      // 失敗したら戻す。消えたまま既読になっていない状態が一番たちが悪い
      setError(`既読にできませんでした: ${updateError.message}`);
      setRows((prev) =>
        [...prev, row].sort((a, b) => b.createdAt.localeCompare(a.createdAt)),
      );
    }
  }

  if (rows.length === 0) return null;

  return (
    <section className="space-y-1">
      <h2 className="text-sm font-bold">
        お知らせ
        <span className="ml-1 rounded-full bg-[#C0392B] px-1.5 text-[10px] font-bold text-white">
          {rows.length}
        </span>
        <span className="ml-1 font-normal text-[10px] text-[var(--muted)]">
          タップで消えます
        </span>
      </h2>

      {error ? (
        <p role="alert" className="text-xs text-[#8B1A10]">
          {error}
        </p>
      ) : null}

      {/*
       * **枠の高さを固定して中でスクロールさせる。**
       * お知らせが増えるとカードが伸びて、下のカレンダーまで延々と
       * スクロールする必要があった。件数に関わらずここの高さは変わらない。
       */}
      <ul className="h-scroll max-h-40 divide-y divide-[var(--border)] overflow-y-auto rounded-xl border border-[var(--border)]">
        {/* ここに並ぶのは未読だけなので、既読/未読の描き分けは要らない */}
        {rows.map((row) => (
          <li key={row.id}>
            <button
              type="button"
              onClick={() => markRead(row)}
              aria-label={`${row.title} を確認して消す`}
              className="flex w-full items-start gap-2 px-3 py-2 text-left"
            >
              <span
                aria-hidden
                className="mt-1.5 h-1.5 w-1.5 shrink-0 rounded-full bg-[#C0392B]"
              />
              <span className="min-w-0 flex-1">
                <span className="block text-sm font-medium">{row.title}</span>
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
        ))}
      </ul>
    </section>
  );
}
