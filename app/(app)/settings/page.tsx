import { redirect } from "next/navigation";

import { SetupNotice } from "@/components/SetupNotice";
import { getCurrentProfile } from "@/lib/auth/session";
import { appBaseUrl, hasSupabaseEnv } from "@/lib/env";
import { createAdminClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";

import { SettingsClient } from "./SettingsClient";

/**
 * 設定画面 (SPEC.md §6.4.1)
 *
 * Phase 1 の範囲:
 *   - 購読URL (webcal / https) の表示・コピー・再発行
 *   - サブジャンル (2ジャン/3ジャン) 設定 … **OB には表示しない**
 *   - ログアウト
 *
 * calendar_tokens は RLS ポリシーを持たない = クライアントからは読めないため
 * (SPEC §5.2)、ここでセッションを確認したうえで service role から取得する。
 */
export default async function SettingsPage() {
  if (!hasSupabaseEnv()) {
    return <SetupNotice />;
  }

  const profile = await getCurrentProfile();
  if (!profile) {
    redirect("/login");
  }

  const supabase = await createClient();
  const { data: subgenreRows } = await supabase
    .from("user_subgenres")
    .select("slot, genre_id")
    .eq("user_id", profile.user_id);

  const admin = createAdminClient();
  const { data: tokenRow } = await admin
    .from("calendar_tokens")
    .select("token")
    .eq("user_id", profile.user_id)
    .maybeSingle();

  const subgenres = (subgenreRows ?? []) as { slot: number; genre_id: number }[];

  return (
    <SettingsClient
      profile={profile}
      initialToken={tokenRow?.token ?? null}
      initialSubgenre2={subgenres.find((s) => s.slot === 2)?.genre_id ?? null}
      initialSubgenre3={subgenres.find((s) => s.slot === 3)?.genre_id ?? null}
      baseUrl={appBaseUrl()}
    />
  );
}
