"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";

import { dbErrorMessage } from "@/lib/error-message";
import { createClient } from "@/lib/supabase/client";
import { formatAsTokyoTime } from "@/lib/time";
import type { NotificationType } from "@/lib/types";

/**
 * お知らせの一覧 (SPEC.md §6.7.13 / v1.36)
 *
 * **押すと既読にして、関係する画面へ移る**。告知のように移る先が無いものは、
 * その場で本文を開く。以前は押した瞬間に消えるだけで、どこにも行けず、
 * 長い告知を読む前に押すと二度と読めなかった。
 * 読んだものは「既読も表示」で見返せる (直近30件)。
 *
 * 生成はすべて DB のトリガとサーバー側で行うので、ここでは読み書きしかしない。
 * RLS は本人分の select/update しか許さない (`sel_notif` / `upd_notif`)。
 */

export interface NotificationRow {
  id: string;
  type: NotificationType;
  title: string;
  body: string | null;
  createdAt: string;
  /** 読んだ時刻。未読は null */
  readAt?: string | null;
}

const TYPE_LABELS: Record<NotificationType, string> = {
  number_added: "ナンバー",
  schedule_updated: "練習日程",
  attendance_updated: "出欠",
  announcement: "3役からの告知",
};

/** 押したときに移る先。無いものはその場で本文を開く */
const DESTINATION: Partial<Record<NotificationType, string>> = {
  number_added: "/number-cal",
  schedule_updated: "/",
};

export function NotificationList({
  initial,
  fullHeight = false,
}: {
  initial: NotificationRow[];
  /** お知らせの画面 (v1.31) では高さを固定せず、全部をそのまま並べる */
  fullHeight?: boolean;
}) {
  const router = useRouter();
  const [rows, setRows] = useState(initial);
  const [showRead, setShowRead] = useState(false);
  const [openId, setOpenId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const unread = rows.filter((r) => !r.readAt);
  const visible = showRead ? rows : unread;
  const readCount = rows.length - unread.length;

  async function open(row: NotificationRow) {
    if (!row.readAt) {
      // 先に画面で既読にする。既読化は失敗しても実害が無く、待たせるほうが損なため
      const now = new Date().toISOString();
      setRows((prev) => prev.map((r) => (r.id === row.id ? { ...r, readAt: now } : r)));
      const { error: updateError } = await createClient()
        .from("notifications")
        .update({ read_at: now })
        .eq("id", row.id);
      if (updateError) {
        setError(dbErrorMessage("既読にできませんでした", updateError));
        setRows((prev) => prev.map((r) => (r.id === row.id ? { ...r, readAt: null } : r)));
      }
    }
    const destination = DESTINATION[row.type];
    if (destination) {
      router.push(destination);
      return;
    }
    // 移る先が無いもの (告知など) は、その場で本文を開く
    setOpenId((current) => (current === row.id ? null : row.id));
  }

  return (
    <section className="space-y-2">
      {error ? (
        <p role="alert" className="text-xs text-[var(--danger-fg)]">
          {error}
        </p>
      ) : null}

      {visible.length === 0 ? (
        <p className="rounded-xl bg-[var(--cell)] px-4 py-6 text-center text-[15px] text-[var(--muted)]">
          新しいお知らせはありません
        </p>
      ) : (
        <ul
          className={`h-scroll divide-y divide-[var(--separator)] overflow-y-auto rounded-xl bg-[var(--cell)] ${
            fullHeight ? "" : "max-h-40"
          }`}
        >
          {visible.map((row) => {
            const isOpen = openId === row.id;
            return (
              <li key={row.id}>
                <button
                  type="button"
                  onClick={() => open(row)}
                  aria-expanded={DESTINATION[row.type] ? undefined : isOpen}
                  className="flex w-full items-start gap-2.5 px-4 py-3 text-left active:bg-[var(--fill)]"
                >
                  <span
                    aria-hidden
                    className={`mt-2 h-2 w-2 shrink-0 rounded-full ${
                      row.readAt ? "bg-transparent" : "bg-[var(--accent)]"
                    }`}
                  />
                  <span className="min-w-0 flex-1">
                    <span
                      className={`block text-[16px] ${row.readAt ? "text-[var(--muted)]" : "font-semibold"}`}
                    >
                      {row.title}
                    </span>
                    {row.body ? (
                      // 告知は改行を含む本文。閉じているときは2行まで (§6.7.4)
                      <span
                        className={`block whitespace-pre-wrap text-[14px] text-[var(--muted)] ${
                          isOpen ? "" : "line-clamp-2"
                        }`}
                      >
                        {row.body}
                      </span>
                    ) : null}
                    <span className="mt-0.5 block text-[12px] text-[var(--muted)]">
                      {TYPE_LABELS[row.type]}・{formatAsTokyoTime(row.createdAt)}
                    </span>
                  </span>
                  {DESTINATION[row.type] ? (
                    <span aria-hidden className="mt-1 shrink-0 text-[17px] text-[var(--muted)]">
                      ›
                    </span>
                  ) : null}
                </button>
              </li>
            );
          })}
        </ul>
      )}

      {readCount > 0 ? (
        <button
          type="button"
          onClick={() => setShowRead((v) => !v)}
          aria-pressed={showRead}
          className="mx-auto block h-10 rounded-full px-4 text-[15px] text-[var(--tint)]"
        >
          {showRead ? "未読だけにする" : `既読も表示(${readCount})`}
        </button>
      ) : null}
    </section>
  );
}
