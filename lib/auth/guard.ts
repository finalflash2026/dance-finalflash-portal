import "server-only";

import { getCurrentProfile } from "@/lib/auth/session";
import { isCoordinatorOrAbove } from "@/lib/constants";
import { hasSupabaseEnv } from "@/lib/env";
import type { Profile, Role } from "@/lib/types";

/**
 * API ルートのロール再検証 (SPEC.md §13.2)
 *
 * 画面側でボタンを隠していても API は直接叩けるので、
 * **サーバー側でロールを引き直す**。RLS も同じ条件で二重に守っているが、
 * ここで弾いたほうが「permission denied」ではなく理由の分かる日本語を返せる。
 *
 * 使い方:
 *   const guard = await requireRole("coordinator");
 *   if (guard instanceof Response) return guard;
 *   // 以降 guard は Profile
 */
export async function requireRole(
  minimum: "coordinator" | "admin",
): Promise<Profile | Response> {
  if (!hasSupabaseEnv()) {
    return Response.json(
      { error: "サーバーの設定が未完了です (Supabase 未接続)" },
      { status: 503 },
    );
  }

  const profile = await getCurrentProfile();
  if (!profile) {
    return Response.json({ error: "ログインしてください" }, { status: 401 });
  }

  const allowed: Role[] =
    minimum === "admin" ? ["admin"] : ["coordinator", "admin"];
  if (!allowed.includes(profile.role)) {
    return Response.json({ error: "権限がありません" }, { status: 403 });
  }

  return profile;
}

/** 画面側 (Server Component) の判定。権限不足は 404 にする (SPEC §7: 存在を隠す) */
export function canUseCoordinator(profile: Profile | null): boolean {
  return profile !== null && isCoordinatorOrAbove(profile.role);
}
