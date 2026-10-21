import { notFound } from "next/navigation";

/**
 * 日程調整 (SPEC.md §6.8 / v1.32)。
 *
 * **本番ではまだ出さない。** 回答の保存と権限 (DB) を次の段階で作るまで 404。
 * 手元の環境 (Supabase 未設定) では middleware が見本の画面 (/demo/schedule) に差し替える。
 */
export default function SchedulePage() {
  notFound();
}
