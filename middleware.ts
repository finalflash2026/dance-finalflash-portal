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
// /auth/callback は Google でログインしたあとの戻り先 (§3.7 / v1.34)
// /auth/app-callback は iOS アプリのログインで、アプリ内の Safari が開く (§2.3 / v1.37)
const PUBLIC_PATHS = ["/login", "/signup", "/auth/callback", "/auth/app-callback"];
/** 認証を要求しない API (トークン自体が鍵 / cron 用) */
const PUBLIC_API_PREFIXES = ["/api/auth", "/api/cal", "/api/health", "/api/cron"];

/**
 * Supabase 未設定の手元の環境で、ふだんのアドレスをデモの画面に差し替える
 * (SPEC §14.1 / v1.31.7)。画面の中のリンクやタブは本番のアドレスを指すので、
 * そのままだとデモの中で移るたびに「セットアップが必要です」になっていた。
 * アドレスは変えずに中身だけ差し替える (rewrite)。デモの無い画面は差し替えない。
 */
function demoPath(pathname: string): string | null {
  const exact: Record<string, string> = {
    "/": "/demo/calendar",
    "/number-cal": "/demo/numbers",
    "/settings": "/demo/settings",
    "/keys": "/demo/keys",
    "/notifications": "/demo/notifications",
    "/manage": "/demo/manage",
    "/admin": "/demo/admin",
    "/coordinator": "/demo/coordinator",
    "/schedule": "/demo/schedule",
    "/schedule/plan": "/demo/schedule/plan",
  };
  if (exact[pathname]) return exact[pathname];
  if (pathname.startsWith("/numbers/")) return "/demo/number";
  return null;
}

export async function middleware(request: NextRequest) {
  // Supabase 未設定 (セットアップ前) は素通しして dev を起動できるようにする。
  // デモのある画面は、デモの中身を出す
  if (!hasSupabaseEnv()) {
    const target = demoPath(request.nextUrl.pathname);
    if (target) {
      const url = request.nextUrl.clone();
      url.pathname = target;
      return NextResponse.rewrite(url);
    }
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
     * /api/cal と /api/health と /api/cron (v1.30) は上の PUBLIC_API_PREFIXES で通しているが、
     * セッション更新のコストを避けるため matcher からも外しておく。
     *
     * **manifest.webmanifest も外す。** ここを通すと未ログインのとき
     * /login へリダイレクトされ、ログイン前にホーム画面へ追加した人に
     * アプリ名 (ff Calendar) と standalone が効かない (SPEC §12)。
     * 中身は公開情報しか無いので認証を要求する理由も無い。
     *
     * **sw.js も外す。** Service Worker はセッションと無関係に取得される
     * ことがあり、ログインHTMLが返るとスクリプトとして解釈できず
     * 登録そのものが失敗する (SPEC §6.6)。中身は固定のコードだけ。
     */
    "/((?!_next/static|_next/image|favicon.ico|manifest.webmanifest|sw.js|api/cal|api/health|api/cron|.*\\.(?:svg|png|jpg|jpeg|gif|webp|ico)$).*)",
  ],
};
