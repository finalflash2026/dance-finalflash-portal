"use client";

import { createContext, useContext } from "react";

import { canWrite } from "@/lib/constants";
import type { Role } from "@/lib/types";

/**
 * ログイン中の人のロールを画面の部品に配る (SPEC.md §3.7 / v1.30)
 *
 * 書き込みのボタンは施錠ボード・部室の鍵・連絡欄・空き申請・出欠・
 * ナンバーと、あちこちの部品に散っている。ページごとにロールを
 * props で降ろしていくと、1か所の渡し忘れで閲覧のみにボタンが出る。
 * レイアウトで1回だけ入れて、部品はここから引く。
 *
 * **ボタンを隠すのは見た目の話。** 禁止そのものは DB の restrictive
 * ポリシー (0018) が持っているので、ここが漏れても書き込みは通らない。
 *
 * このファイルは "use client" なので、**サーバー側から呼ぶ関数を置かない**
 * (判定の本体は lib/constants.ts の canWrite)。
 */

const RoleContext = createContext<Role | null>(null);

export function RoleProvider({
  role,
  children,
}: {
  role: Role;
  children: React.ReactNode;
}) {
  return <RoleContext.Provider value={role}>{children}</RoleContext.Provider>;
}

/** 書き込みのボタンを出してよいか。閲覧のみなら false */
export function useCanWrite(): boolean {
  const role = useContext(RoleContext);
  // レイアウトの外 (ログイン画面など) では書き込みの部品自体を使わない。
  // 万一使われても DB が弾くので、ここでは止めない
  return role === null ? true : canWrite(role);
}
