import "server-only";

import { createAdminClient } from "@/lib/supabase/admin";
import { hasSupabaseEnv } from "@/lib/env";

/**
 * 登録の「期」の候補 (SPEC.md §3.2 / v1.36)。現役の期と、その次の期 (まだ誰も
 * 登録していない新入生の期)。新しい順。登録の前に出すので service role で読む
 * (返すのは期の数字だけ)。
 */
export async function generationChoices(): Promise<number[]> {
  if (!hasSupabaseEnv()) return [];
  const { data } = await createAdminClient().from("profiles").select("generation").neq("role", "ob");
  const active = [...new Set(((data ?? []) as { generation: number }[]).map((r) => r.generation))];
  if (active.length === 0) return [];
  const newest = Math.max(...active);
  return [newest + 1, ...active.sort((a, b) => b - a)];
}
