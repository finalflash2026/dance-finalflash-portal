import { redirect } from "next/navigation";

/**
 * 割り振りは折衝ワークフローの② (SPEC.md §6.2 / §6.8.4 / v1.42)。
 * 前の入口 (お知らせ・ブックマーク) から来た人をそこへ送る
 */
export default function SchedulePlanPage() {
  redirect("/coordinator?step=plan");
}
