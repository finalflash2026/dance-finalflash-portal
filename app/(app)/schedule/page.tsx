import { notFound, redirect } from "next/navigation";

import { getCurrentProfile } from "@/lib/auth/session";
import { liveDemoRound } from "@/lib/scheduling/round";
import { loadLiveRoundInput } from "@/lib/scheduling/live";

import { ScheduleAnswerClient } from "./ScheduleClient";

/**
 * 日程調整の回答 (SPEC.md §6.8.4 / v1.35)。
 *
 * Supabase につないだデモ環境で試せるようにした。候補は DB の予約枠から作り、
 * 自分の回答は端末に保存する (DB に保存するのは次の段階)。
 * 手元の環境 (Supabase 未設定) では middleware が見本の画面 (/demo/schedule) に差し替える。
 * OB は公式練に関わらないので出さない (§3.6)。
 */
export const dynamic = "force-dynamic";

export default async function SchedulePage() {
  const profile = await getCurrentProfile();
  if (!profile) redirect("/login");
  if (profile.role === "ob") notFound();

  const round = liveDemoRound();
  const input = await loadLiveRoundInput(round);
  return (
    <ScheduleAnswerClient
      // 回答の画面には自分の分だけ渡す (他の人の見本の回答は要らない)
      initialInput={{ ...input, members: [], answers: {} }}
      me={profile.user_id}
      round={round}
      storageKey={`schedule-answers:${round.month}:${profile.user_id}`}
    />
  );
}
