import { redirect } from "next/navigation";

import { NotificationList, type NotificationRow } from "@/components/NotificationList";
import { SetupNotice } from "@/components/SetupNotice";
import { getCurrentProfile } from "@/lib/auth/session";
import { hasSupabaseEnv } from "@/lib/env";
import { createClient } from "@/lib/supabase/server";

/**
 * お知らせ (SPEC.md §6.7.13 / v1.31)
 *
 * ホームの欄をやめ、ヘッダーのベルから開く画面にした。未読と、既読の直近30件を
 * 渡す (押すと関係する画面へ移る。既読は「既読も表示」で見返せる。v1.36)。
 */
export default async function NotificationsPage() {
  if (!hasSupabaseEnv()) return <SetupNotice />;
  const profile = await getCurrentProfile();
  if (!profile) redirect("/login");

  const supabase = await createClient();
  const { data } = await supabase
    .from("notifications")
    .select("id, type, title, body, created_at, read_at")
    .order("created_at", { ascending: false })
    .limit(80);

  const rows: NotificationRow[] = (
    (data ?? []) as {
      id: string;
      type: NotificationRow["type"];
      title: string;
      body: string | null;
      created_at: string;
      read_at: string | null;
    }[]
  )
    // 未読は全部、既読は直近30件
    .filter((row, index, all) => !row.read_at || all.filter((r, j) => r.read_at && j <= index).length <= 30)
    .map((row) => ({
    id: row.id,
    type: row.type,
    title: row.title,
    body: row.body,
    createdAt: row.created_at,
    readAt: row.read_at,
  }));

  return (
    <main className="mx-auto max-w-2xl space-y-4 px-4 py-3">
      <h1 className="text-[28px] font-bold leading-tight">お知らせ</h1>
      <NotificationList initial={rows} fullHeight />
    </main>
  );
}
