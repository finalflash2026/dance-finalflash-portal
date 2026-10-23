import { notFound } from "next/navigation";

/**
 * 日程調整の集計と割り振り (SPEC.md §6.8.4 / v1.33.1)。折衝・3役だけ。
 *
 * **本番ではまだ出さない。** 回答の保存と権限 (DB) を次の段階で作るまで 404。
 * 手元の環境 (Supabase 未設定) では middleware が見本の画面 (/demo/schedule/plan) に差し替える。
 */
export default function SchedulePlanPage() {
  notFound();
}
