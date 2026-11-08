import { notFound } from "next/navigation";

import { SetupNotice } from "@/components/SetupNotice";
import { canUseCoordinator } from "@/lib/auth/guard";
import { getCurrentProfile } from "@/lib/auth/session";
import { hasSupabaseEnv } from "@/lib/env";

import { getOpenRound } from "@/lib/scheduling/live";
import { todayInTokyo } from "@/lib/time";
import { CoordinatorClient } from "./CoordinatorClient";

/**
 * 折衝ワークフロー (SPEC.md §6.2 / §7)
 *
 * 権限不足は **404**。403 だと「このURLは存在する」と分かってしまうため、
 * SPEC §7 の方針に従って存在ごと隠す。
 *
 * ここはあくまで表示制御であり、認可の実体は
 * API 側の requireRole() と RLS (all_imports / all_resv) にある (SPEC §13.2)。
 */
export default async function CoordinatorPage() {
  if (!hasSupabaseEnv()) {
    return <SetupNotice />;
  }

  const profile = await getCurrentProfile();
  if (!canUseCoordinator(profile)) {
    notFound();
  }

  // 日程調整の欄は、表で選んでいる月の回と回答を画面が読みにいく (§6.2 / v1.44)
  const openRound = await getOpenRound(todayInTokyo(), profile!.user_id);
  return <CoordinatorClient openRoundMonth={openRound?.month ?? null} />;
}
