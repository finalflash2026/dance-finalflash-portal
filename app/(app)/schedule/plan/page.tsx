import { redirect } from "next/navigation";

import { getCurrentProfile } from "@/lib/auth/session";
import { isCoordinatorOrAbove } from "@/lib/constants";
import { liveDemoRound } from "@/lib/scheduling/round";
import { loadLiveRoundInput } from "@/lib/scheduling/live";

import { SchedulePlanClient } from "../ScheduleClient";

/**
 * 日程調整の集計と割り振り (SPEC.md §6.8.4 / v1.35)。**折衝・3役だけ**。
 *
 * デモ環境では、候補は DB の予約枠、部員は DB の現役、回答は見本 (見ている人の
 * 分だけ、回答の画面で端末に保存したもの) で計算する。
 * 手元の環境 (Supabase 未設定) では middleware が見本の画面 (/demo/schedule/plan) に差し替える。
 */
export const dynamic = "force-dynamic";

export default async function SchedulePlanPage() {
  const profile = await getCurrentProfile();
  if (!profile) redirect("/login");

  const round = liveDemoRound();
  const canPlan = isCoordinatorOrAbove(profile.role);
  const input = canPlan
    ? await loadLiveRoundInput(round)
    : { genres: [], candidates: [], members: [], answers: {} };
  return (
    <SchedulePlanClient
      initialInput={input}
      round={round}
      canPlan={canPlan}
      me={profile.user_id}
      storageKey={`schedule-answers:${round.month}:${profile.user_id}`}
    />
  );
}
