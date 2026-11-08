import { redirect } from "next/navigation";

import { BackButton } from "@/components/BackButton";
import { BellButton } from "@/components/BellButton";
import { HeaderIdentity } from "@/components/HeaderIdentity";
import { HelpButton } from "@/components/HelpButton";
import { LaunchPrompts } from "@/components/LaunchPrompts";
import { PageTransition } from "@/components/PageTransition";
import { PullToRefresh } from "@/components/PullToRefresh";
import { ServiceWorkerRegistrar } from "@/components/ServiceWorkerRegistrar";
import { SettingsButton } from "@/components/SettingsButton";
import { StaffNav } from "@/components/StaffNav";
import { SwipeTabs } from "@/components/SwipeTabs";
import { TabBar } from "@/components/TabBar";
import { Tour } from "@/components/Tour";
import { getCurrentProfile } from "@/lib/auth/session";
import { ROLE_LABELS, isCoordinatorOrAbove } from "@/lib/constants";
import { VAPID_PUBLIC_KEY, hasSupabaseEnv } from "@/lib/env";
import { RoomsProvider } from "@/lib/rooms";
import { ROOMS } from "@/lib/constants";
import { fetchRooms } from "@/lib/rooms-server";
import { createClient } from "@/lib/supabase/server";
import type { Role } from "@/lib/types";

/**
 * ログイン後の共通レイアウト (SPEC.md §6.0 / §7)
 *
 * ここで role を1回だけ取得し、タブバーの構成を決める。
 * middleware で role を引くと全リクエストで DB クエリが走るため、
 * ロール依存の判定はこの層に集約している。
 *
 * `/overview` は v1.30 でカレンダーへ統合し、overview 側で `/` へ転送している。
 *
 * **アニメーションとスワイプはレイアウトに置く** (v1.14)。
 * `template.tsx` だと `?date=` が変わるだけでも作り直され、日付を選ぶたびに
 * 画面全体が動いてしまう。レイアウトは遷移しても保たれるので、
 * 中の PageTransition がパスの変化だけを見て動かせる。
 */
export default async function AppLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  // **並列で取る。** 部屋は全画面で使うが、profile を待ってから引くと
  // 往復が1つ増えて起動が遅くなる (§13.1)
  const [profile, rooms, unread] = await Promise.all([
    getCurrentProfile(),
    hasSupabaseEnv()
      ? createClient().then(fetchRooms)
      : Promise.resolve(ROOMS),
    // ベルに出す未読の数 (§6.7.13)。件数だけ数える (中身は取らない)
    hasSupabaseEnv()
      ? createClient().then(async (supabase) => {
          const { count } = await supabase
            .from("notifications")
            .select("id", { count: "exact", head: true })
            .is("read_at", null);
          return count ?? 0;
        })
      : Promise.resolve(1),
  ]);
  // Google でログインしたが、まだ登録 (期・ジャンル・合言葉) を終えていない人 (§3.7 / v1.34)。
  // アプリの画面には入れず、登録の続きへ送る
  if (hasSupabaseEnv() && !profile) redirect("/welcome");

  // Supabase 未設定 (セットアップ前) は member 相当で表示する
  const role: Role = profile?.role ?? "member";

  return (
    /* 浮いたタブバーのぶんの下の余白は TabBar が置く (サブ画面ではバーを出さない。v1.32.7) */
    <div className="min-h-dvh">
      {/* 上端はノッチ・ステータスバーを避ける (v1.32.7。viewport-fit=cover のため) */}
      <header className="flex items-center justify-between gap-2 px-4 pb-2 pt-[max(env(safe-area-inset-top),8px)]">
        <div className="flex min-w-0 items-center gap-2">
          {/* 設定・鍵・お知らせなどでは左上に戻るボタン (v1.31.9。どの画面でも同じ場所) */}
          <BackButton />
          {/* 未ログイン (セットアップ前・デモ) ではサイト名を出さない (v1.31.5。場所を取るだけ) */}
          {/* 名前はタブの画面でだけ (v1.32.7。サブ画面では戻るボタンの隣に並べない) */}
          {profile ? (
            <HeaderIdentity
              username={profile.username}
              roleLabel={profile.role !== "member" ? ROLE_LABELS[profile.role] : null}
            />
          ) : null}
        </div>
        {/* ? と歯車 (v1.30 §6.7.8)。どちらも同じ丸い浮いたボタン */}
        <div className="flex shrink-0 items-center gap-2">
          <BellButton unread={unread} />
          <HelpButton />
          <SettingsButton />
        </div>
      </header>

      {/* 運営の画面 (折衝・割り振り・イベント・管理者) の切り替え (v1.39)。
          デモ (Supabase 未設定) では全部見せる */}
      {isCoordinatorOrAbove(role) || !hasSupabaseEnv() ? (
        <StaffNav showAdmin={role === "admin" || !hasSupabaseEnv()} />
      ) : null}

      <RoomsProvider rooms={rooms}>
        <PullToRefresh>
          <SwipeTabs role={role}>
            <PageTransition>{children}</PageTransition>
          </SwipeTabs>
        </PullToRefresh>
      </RoomsProvider>

      <TabBar role={role} />

      {/* 初回ツアーと、起動時の案内 (ホーム画面への追加・通知。§6.7.9) */}
      <Tour />
      {profile || !hasSupabaseEnv() ? (
        <LaunchPrompts
          vapidPublicKey={VAPID_PUBLIC_KEY}
          // デモ (Supabase 未設定) は現役として出す
          isActiveMember={profile ? profile.role !== "ob" : true}
        />
      ) : null}

      {/* 静的ファイルを端末に持たせて、次回の起動を速くする (§13.1) */}
      <ServiceWorkerRegistrar />
    </div>
  );
}
