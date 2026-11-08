import { NextResponse } from "next/server";

import { APP_AUTH_CALLBACK } from "@/lib/native";

/**
 * iOS アプリから Google でログインしたあとの戻り先 (SPEC.md §2.3 / §3.7 / v1.37)。
 *
 * ここはアプリ内の Safari で開かれる。**セッションは作らない。** Safari と
 * アプリの WebView は cookie が別なので、ここで作ってもアプリはログインしない。
 * コードを `ffcalendar://` でアプリへ渡し、アプリの WebView が `/auth/callback`
 * でセッションに換える。PKCE の鍵はその WebView の cookie にしか無いので、
 * コードだけが漏れても使えない。
 */
export function GET(request: Request) {
  const params = new URL(request.url).searchParams;
  const target = new URL(APP_AUTH_CALLBACK);
  const code = params.get("code");
  if (code) target.searchParams.set("code", code);
  else target.searchParams.set("error", params.get("error") ?? "google");
  return NextResponse.redirect(target);
}
