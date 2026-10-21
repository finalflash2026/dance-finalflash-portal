"use client";

import { usePathname } from "next/navigation";

import { backTarget } from "@/components/BackButton";

/**
 * ヘッダー左のユーザー名と役職 (SPEC §6.7.13)。
 *
 * **タブの画面 (ホーム・ナンバー) でだけ出す** (v1.32.7)。戻るボタンが出る
 * 画面で戻るボタンの隣に名前が並ぶと、「何の画面か」より「誰の画面か」が
 * 目に入る (iOS のナビゲーションバーは、左上が戻る・その先が画面の名前)。
 */
export function HeaderIdentity({
  username,
  roleLabel,
}: {
  username: string;
  roleLabel: string | null;
}) {
  const pathname = usePathname();
  if (backTarget(pathname)) return null;
  return (
    <div className="min-w-0">
      <p className="truncate text-sm font-bold">{username}</p>
      {roleLabel ? <p className="text-xs text-[var(--muted)]">{roleLabel}</p> : null}
    </div>
  );
}
