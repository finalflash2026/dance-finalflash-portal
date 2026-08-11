import Link from "next/link";

import { TabBar } from "@/components/TabBar";
import { getCurrentProfile } from "@/lib/auth/session";
import { ROLE_LABELS } from "@/lib/constants";
import type { Role } from "@/lib/types";

/**
 * ログイン後の共通レイアウト (SPEC.md §6.0 / §7)
 *
 * ここで role を1回だけ取得し、タブバーの構成を決める。
 * middleware で role を引くと全リクエストで DB クエリが走るため、
 * ロール依存の判定はこの層に集約している。
 *
 * OB の `/` → `/me` リダイレクトは app/(app)/page.tsx 側で行う
 * (レイアウトでやるとリダイレクト先の /me でも同じ判定が走ってしまうため)。
 */
export default async function AppLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  const profile = await getCurrentProfile();
  // Supabase 未設定 (セットアップ前) は member 相当で表示する
  const role: Role = profile?.role ?? "member";

  return (
    <div className="min-h-dvh pb-14">
      <header className="flex items-center justify-between border-b border-[var(--border)] px-4 py-2">
        <div className="min-w-0">
          <p className="truncate text-sm font-bold">
            {profile?.username ?? "ダンスサークル練習管理"}
          </p>
          {profile && profile.role !== "member" ? (
            <p className="text-xs text-[var(--muted)]">
              {ROLE_LABELS[profile.role]}
            </p>
          ) : null}
        </div>
        <Link
          href="/settings"
          className="shrink-0 rounded-lg border border-[var(--border)] px-3 py-1.5 text-sm"
        >
          設定
        </Link>
      </header>

      {children}
      <TabBar role={role} />
    </div>
  );
}
