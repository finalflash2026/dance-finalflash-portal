import { redirect } from "next/navigation";

import { KeysHistory } from "@/components/KeysHistory";
import { ClubKeyBoard } from "@/components/ClubKeyBoard";
import { SetupNotice } from "@/components/SetupNotice";
import { getCurrentProfile } from "@/lib/auth/session";
import { toBoardMessages } from "@/lib/board-messages";
import { KEY_HISTORY_LIMIT, toKeyHolderRows } from "@/lib/club-key";
import { hasSupabaseEnv } from "@/lib/env";
import { createClient } from "@/lib/supabase/server";

/**
 * 部室の鍵と連絡 (SPEC.md §6.1.2 / §6.1.3)。
 * v1.50.4 で練習場所 (/keys/room) と別の画面にした。OB は使えない (§3.6)
 */
export default async function ClubKeyPage() {
  if (!hasSupabaseEnv()) return <SetupNotice />;
  const profile = await getCurrentProfile();
  if (!profile) redirect("/login");
  if (profile.role === "ob") redirect("/");

  const supabase = await createClient();
  const [keyResult, messagesResult] = await Promise.all([
    supabase
      .from("club_key_holders")
      .select("id, user_id, taken_at, profiles(username)")
      .order("taken_at", { ascending: false })
      .limit(KEY_HISTORY_LIMIT),
    supabase
      .from("board_messages")
      .select("id, scope, date, body, user_id, created_at, profiles(username)")
      .eq("scope", "club_key")
      .order("created_at", { ascending: true }),
  ]);

  return (
    <main className="mx-auto max-w-2xl space-y-4 px-4 py-3">
      <h1 className="text-[28px] font-bold leading-tight">部室の鍵</h1>
      <ClubKeyBoard
        initialRows={toKeyHolderRows(keyResult.data)}
        currentUserId={profile.user_id}
        initialMessages={toBoardMessages(messagesResult.data ?? [])}
      />
      <KeysHistory kind="club-key" />
    </main>
  );
}
