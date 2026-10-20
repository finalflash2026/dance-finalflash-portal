import { redirect } from "next/navigation";

import { NotificationList, type NotificationRow } from "@/components/NotificationList";
import { SetupNotice } from "@/components/SetupNotice";
import { getCurrentProfile } from "@/lib/auth/session";
import { hasSupabaseEnv } from "@/lib/env";
import { createClient } from "@/lib/supabase/server";

/**
 * お知らせ (SPEC.md §6.7.13 / v1.31)
 *
 * ホームの欄をやめ、ヘッダーのベルから開く画面にした。並ぶのは未読だけで、
 * 押すと既読になって消える (§6.4-2 と同じ)。
 */
export default async function NotificationsPage() {
  if (!hasSupabaseEnv()) return <SetupNotice />;
  const profile = await getCurrentProfile();
  if (!profile) redirect("/login");

  const supabase = await createClient();
  const { data } = await supabase
    .from("notifications")
    .select("id, type, title, body, created_at")
    .is("read_at", null)
    .order("created_at", { ascending: false })
    .limit(50);

  const rows: NotificationRow[] = (
    (data ?? []) as {
      id: string;
      type: NotificationRow["type"];
      title: string;
      body: string | null;
      created_at: string;
    }[]
  ).map((row) => ({
    id: row.id,
    type: row.type,
    title: row.title,
    body: row.body,
    createdAt: row.created_at,
  }));

  return (
    <main className="mx-auto max-w-2xl space-y-4 px-4 py-3">
      <h1 className="text-[28px] font-bold leading-tight">お知らせ</h1>
      {rows.length === 0 ? (
        <p className="rounded-xl bg-[var(--cell)] px-4 py-6 text-center text-[15px] text-[var(--muted)]">
          新しいお知らせはありません
        </p>
      ) : (
        <NotificationList initial={rows} fullHeight />
      )}
    </main>
  );
}
