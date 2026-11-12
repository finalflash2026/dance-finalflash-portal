import { notFound } from "next/navigation";

import { hasSupabaseEnv } from "@/lib/env";

/**
 * デモ画面 (`/demo`)。見本のデータで各画面を表示する、見た目確認用の入口。
 *
 * **Supabase が設定されていない手元の環境でだけ開ける。** 本番・プレビューは
 * 環境変数が入っているので 404 になる (存在ごと隠す。SPEC §7)。
 * 見本のデータなので保存はされない (ブラウザ側は lib/supabase/demo-client.ts)。
 * 起動: `npm run dev` → http://localhost:3000/demo
 */
export default function DemoLayout({ children }: { children: React.ReactNode }) {
  if (hasSupabaseEnv()) notFound();
  // 「デモ表示」の帯は出さない (v1.31.5)。実際の見た目と比べにくくなる
  return children;
}
