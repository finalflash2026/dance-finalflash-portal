import { notFound } from "next/navigation";

import { hasSupabaseEnv } from "@/lib/env";

/**
 * デモ画面 (`/demo`)。見本のデータで各画面を表示する、見た目確認用の入口。
 *
 * **Supabase が設定されていない手元の環境でだけ開ける。** 本番・プレビューは
 * 環境変数が入っているので 404 になる (存在ごと隠す。SPEC §7)。
 * 起動: `npm run dev` → http://localhost:3000/demo
 */
export default function DemoLayout({ children }: { children: React.ReactNode }) {
  if (hasSupabaseEnv()) notFound();
  return (
    <>
      <p className="mx-4 mb-1 rounded-lg bg-[var(--fill)] px-3 py-1.5 text-center text-[12px] text-[var(--muted)]">
        デモ表示 (見本のデータ・保存はされません)
      </p>
      {children}
    </>
  );
}
