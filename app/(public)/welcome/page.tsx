import { redirect } from "next/navigation";

import { getCurrentProfile } from "@/lib/auth/session";

import { SignupForm } from "../signup/SignupForm";

/**
 * Google でログインしたあとの登録の続き (SPEC.md §3.7 / v1.34)。
 *
 * ログインはできているが、まだプロフィール (期・ジャンル・名前) が無い人が来る。
 * 合言葉を通して初めてアプリの画面に入れる。登録を終えた人はホームへ送る。
 */
export default async function WelcomePage() {
  if (await getCurrentProfile()) redirect("/");

  return (
    <div className="space-y-6">
      <h1 className="text-2xl font-bold">登録</h1>
      <SignupForm google />
    </div>
  );
}
