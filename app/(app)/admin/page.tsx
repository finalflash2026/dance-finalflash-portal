import { notFound } from "next/navigation";

import { SetupNotice } from "@/components/SetupNotice";
import { getCurrentProfile } from "@/lib/auth/session";
import { hasSupabaseEnv } from "@/lib/env";
import { createClient } from "@/lib/supabase/server";
import type { Profile } from "@/lib/types";

import { AdminClient, type AdminUser } from "./AdminClient";

/**
 * 管理者画面 (SPEC.md §6.5 / §7)
 *
 * 権限不足は **404**。折衝画面と同じく存在ごと隠す (SPEC §7)。
 * ここは表示制御であり、認可の実体は API 側の requireRole("admin") にある。
 * profiles の role 変更には RLS ポリシーが無いので、
 * `/api/admin/**` を通らない限り誰も書き換えられない (SPEC §5.2)。
 *
 * 一覧そのものは名簿として全員に公開されている情報なので (`sel_profiles`)、
 * service role ではなくログインセッションのまま引く。
 */
export default async function AdminPage() {
  if (!hasSupabaseEnv()) {
    return <SetupNotice />;
  }

  const profile = await getCurrentProfile();
  if (!profile || profile.role !== "admin") {
    notFound();
  }

  const supabase = await createClient();
  const { data, error } = await supabase
    .from("profiles")
    .select("user_id, username, generation, main_genre_id, display_name, role")
    .order("generation", { ascending: false })
    .order("username");

  const users: AdminUser[] = (
    (data ?? []) as Pick<
      Profile,
      "user_id" | "username" | "generation" | "main_genre_id" | "display_name" | "role"
    >[]
  ).map((row) => ({
    userId: row.user_id,
    username: row.username,
    generation: row.generation,
    mainGenreId: row.main_genre_id,
    displayName: row.display_name,
    role: row.role,
  }));

  return (
    <AdminClient
      currentUserId={profile.user_id}
      initialUsers={users}
      loadError={error ? `名簿を取得できませんでした: ${error.message}` : null}
    />
  );
}
