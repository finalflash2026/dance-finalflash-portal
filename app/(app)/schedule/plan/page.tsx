import { redirect } from "next/navigation";

/**
 * 割り振りは折衝ワークフローの②コマ割りの中 (SPEC.md §6.2 / §6.8.4 / v1.43)。
 * 前の入口 (お知らせ・ブックマーク) から来た人を、案の欄を開いた状態へ送る
 */
export default function SchedulePlanPage() {
  redirect("/coordinator?step=plan");
}
