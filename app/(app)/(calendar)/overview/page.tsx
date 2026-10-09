import { redirect } from "next/navigation";

/**
 * 旧・全体カレンダー (SPEC.md §6.7.7 / §7 / v1.30)
 *
 * マイカレンダーと1つにまとめたので `/` へ送る。ブックマークと、
 * 古い通知 (行き先が `/overview`) を死なせないために残している。
 * 選んでいた日付 (`?date=`) は引き継ぐ。
 */
export default async function OverviewRedirect({
  searchParams,
}: {
  searchParams: Promise<{ date?: string }>;
}) {
  const { date } = await searchParams;
  redirect(date ? `/?date=${encodeURIComponent(date)}` : "/");
}
