import { createServerClient } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";

import { SUPABASE_ANON_KEY, SUPABASE_URL, hasSupabaseEnv } from "@/lib/env";

/**
 * セッション更新と未ログインリダイレクト (SPEC.md §7)
 *
 * ここでやること:
 *   1. @supabase/ssr のセッション更新 (アクセストークンの自動リフレッシュ)
 *   2. 未ログインなら /login へリダイレクト
 *
 * ここでやらないこと:
 *   - **OB の `/` → `/me` リダイレクト**。role を引くと全リクエストで DB クエリが
 *     走るため、app/(app)/layout.tsx の Server Component 側で判定する (SPEC §6.0)。
 *   - 認可判断そのもの。最終防衛線は RLS (SPEC §13.2)。
 */

/** 未ログインでもアクセスできるパス */
const PUBLIC_PATHS = ["/login", "/signup"];
/** 認証を要求しない API (トークン自体が鍵 / cron 用) */
const PUBLIC_API_PREFIXES = ["/api/auth", "/api/cal", "/api/health"];

export async function middleware(request: NextRequest) {
  // Supabase 未設定 (セットアップ前) は素通しして dev を起動できるようにする
  if (!hasSupabaseEnv()) {
    return NextResponse.next({ request });
  }

  let response = NextResponse.next({ request });

  const supabase = createServerClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
    cookies: {
      getAll() {
        return request.cookies.getAll();
      },
      setAll(cookiesToSet) {
        for (const { name, value } of cookiesToSet) {
          request.cookies.set(name, value);
        }
        response = NextResponse.next({ request });
        for (const { name, value, options } of cookiesToSet) {
          response.cookies.set(name, value, options);
        }
      },
    },
  });

  // getUser() を必ず呼ぶこと。これがトークンのリフレッシュを行う
  const {
    data: { user },
  } = await supabase.auth.getUser();

  const { pathname } = request.nextUrl;
  const isPublicPage = PUBLIC_PATHS.includes(pathname);
  const isPublicApi = PUBLIC_API_PREFIXES.some((p) => pathname.startsWith(p));

  if (!user && !isPublicPage && !isPublicApi) {
    // API は JSON で 401 を返す。リダイレクトすると fetch 側が
    // ログインHTMLを受け取ってしまい、エラー処理ができなくなるため
    if (pathname.startsWith("/api/")) {
      return Response.json({ error: "ログインしてください" }, { status: 401 });
    }
    const url = request.nextUrl.clone();
    url.pathname = "/login";
    url.search = "";
    return NextResponse.redirect(url);
  }

  if (user && isPublicPage) {
    const url = request.nextUrl.clone();
    url.pathname = "/";
    url.search = "";
    return NextResponse.redirect(url);
  }

  return response;
}

export const config = {
  matcher: [
    /*
     * 以下を除く全パスに適用:
     *   _next/static, _next/image, favicon.ico, 画像ファイル
     * /api/cal と /api/health は上の PUBLIC_API_PREFIXES で通しているが、
     * セッション更新のコストを避けるため matcher からも外しておく。
     */
    "/((?!_next/static|_next/image|favicon.ico|api/cal|api/health|.*\\.(?:svg|png|jpg|jpeg|gif|webp|ico)$).*)",
  ],
};
