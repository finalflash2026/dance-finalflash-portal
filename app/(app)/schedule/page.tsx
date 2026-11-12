import { notFound, redirect } from "next/navigation";

import { getCurrentProfile } from "@/lib/auth/session";
import { isActiveMember } from "@/lib/constants";
import { getOpenRound, loadMonthInput } from "@/lib/scheduling/live";
import { todayInTokyo } from "@/lib/time";

import { ScheduleAnswerClient } from "./ScheduleClient";

/**
 * 日程調整の回答 (SPEC.md §6.8.4 / v1.35)。
 *
 * 候補はその月の予約枠から作り、回答は押すたびに DB に保存する (v1.44)。
 * 手元の環境 (Supabase 未設定) では middleware が見本の画面 (/demo/schedule) に差し替える。
 * OB は公式練に関わらないので出さない (§3.6)。閲覧のみも答えないので出さない (§3.8)。
 */
export const dynamic = "force-dynamic";

export default async function SchedulePage() {
  const profile = await getCurrentProfile();
  if (!profile) redirect("/login");
  if (!isActiveMember(profile.role)) notFound();

  // 受付中の回 (v1.44)。無ければ答えるものが無い
  const round = await getOpenRound(todayInTokyo(), profile.user_id);
  if (!round) {
    return (
      <main className="mx-auto max-w-3xl px-4 py-10 text-center text-[15px] text-[var(--muted)]">
        受付中の日程調整はありません
      </main>
    );
  }
  // 回答の画面には自分の回答だけ渡す (他の人の回答は見せない。§6.8.1)
  const input = await loadMonthInput(round.month, round.id, { onlyUser: profile.user_id });
  return <ScheduleAnswerClient initialInput={input} me={profile.user_id} round={round} persist />;
}
