import { NextResponse } from "next/server";

import { createClient } from "@/lib/supabase/server";

/**
 * Google でログインしたあとの戻り先 (SPEC.md §3.7 / v1.34)。
 *
 * Google から戻ってきた `code` をセッションに換え、プロフィールがあればホーム、
 * 無ければ登録の続き (`/welcome`) へ送る。失敗したらログイン画面に理由を付けて戻す。
 */
export async function GET(request: Request) {
  const url = new URL(request.url);
  const code = url.searchParams.get("code");
  const back = (path: string) => NextResponse.redirect(new URL(path, url.origin));

  if (!code) return back("/login?error=google");

  const supabase = await createClient();
  const { data, error } = await supabase.auth.exchangeCodeForSession(code);
  if (error || !data.user) return back("/login?error=google");

  const { data: profile } = await supabase
    .from("profiles")
    .select("user_id")
    .eq("user_id", data.user.id)
    .maybeSingle();

  return back(profile ? "/" : "/welcome");
}
