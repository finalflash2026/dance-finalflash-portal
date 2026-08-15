import { redirect } from "next/navigation";

import { SetupNotice } from "@/components/SetupNotice";
import { getCurrentProfile } from "@/lib/auth/session";
import { hasSupabaseEnv } from "@/lib/env";
import { createClient } from "@/lib/supabase/server";

import { NumbersClient } from "./NumbersClient";

/**
 * ナンバー管理: 所属一覧 + 新規作成 (SPEC.md §6.3 / §7)
 *
 * **一覧・検索ページは作らない。** ここに並ぶのは自分が所属するナンバーだけで、
 * 非メンバーには存在自体が見えない。絞り込みはクエリに書いておらず、
 * RLS の `sel_numbers` (= is_number_member) がそのまま効いている。
 *
 * OB も作成・主催できる (縦イベ用。SPEC §6.3)。
 */
export default async function NumbersPage() {
  if (!hasSupabaseEnv()) {
    return <SetupNotice />;
  }

  const profile = await getCurrentProfile();
  if (!profile) {
    redirect("/login");
  }

  const supabase = await createClient();
  const { data, error } = await supabase
    .from("numbers")
    .select("id, name, owner_id, number_members(user_id)")
    .order("created_at");

  const numbers = (
    (data ?? []) as unknown as {
      id: string;
      name: string;
      owner_id: string;
      number_members: { user_id: string }[] | null;
    }[]
  ).map((row) => ({
    id: row.id,
    name: row.name,
    isOwner: row.owner_id === profile.user_id,
    memberCount: (row.number_members ?? []).length,
  }));

  return (
    <NumbersClient
      numbers={numbers}
      currentUserId={profile.user_id}
      loadError={error?.message ?? null}
    />
  );
}
