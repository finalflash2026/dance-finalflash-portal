import { PageTransition } from "@/components/PageTransition";
import { PullToRefresh } from "@/components/PullToRefresh";
import { SettingsButton } from "@/components/SettingsButton";
import { SwipeTabs } from "@/components/SwipeTabs";
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
 * OB の `/overview` → `/` リダイレクトは overview 側で行う
 * (レイアウトでやるとリダイレクト先でも同じ判定が走ってしまうため)。
 *
 * **アニメーションとスワイプはレイアウトに置く** (v1.14)。
 * `template.tsx` だと `?date=` が変わるだけでも作り直され、日付を選ぶたびに
 * 画面全体が動いてしまう。レイアウトは遷移しても保たれるので、
 * 中の PageTransition がパスの変化だけを見て動かせる。
 */
export default async function AppLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  const profile = await getCurrentProfile();
  // Supabase 未設定 (セットアップ前) は member 相当で表示する
  const role: Role = profile?.role ?? "member";

  return (
    /* 浮いたタブバーのぶん、下に余白を置く (バーの高さ + 逃げ) */
    <div className="min-h-dvh pb-24">
      <header className="flex items-center justify-between gap-2 px-4 py-2">
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
        <SettingsButton />
      </header>

      <PullToRefresh>
        <SwipeTabs role={role}>
          <PageTransition>{children}</PageTransition>
        </SwipeTabs>
      </PullToRefresh>

      <TabBar role={role} />
    </div>
  );
}
