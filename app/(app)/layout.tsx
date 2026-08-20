import Link from "next/link";

import { PageTransition } from "@/components/PageTransition";
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
        <Link
          href="/settings"
          aria-label="設定"
          className="glass flex h-10 w-10 shrink-0 items-center justify-center rounded-full"
        >
          <MenuIcon />
        </Link>
      </header>

      <SwipeTabs role={role}>
        <PageTransition>{children}</PageTransition>
      </SwipeTabs>

      <TabBar role={role} />
    </div>
  );
}

/**
 * 設定の入口 (SPEC §12 / v1.14)
 *
 * 上から順に短くなる3本線。文字の「設定」から替えたのは、
 * 画面の幅を文字に取られていたのと、浮いた丸ボタンに文字が収まらないため。
 * 意味は `aria-label` が持つので、読み上げでは今までどおり「設定」と読まれる。
 */
function MenuIcon() {
  return (
    <svg
      width="18"
      height="14"
      viewBox="0 0 18 14"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      aria-hidden
    >
      <line x1="1" y1="1" x2="17" y2="1" />
      <line x1="1" y1="7" x2="12" y2="7" />
      <line x1="1" y1="13" x2="7" y2="13" />
    </svg>
  );
}
