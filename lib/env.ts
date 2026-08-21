/**
 * 環境変数の読み出し (SPEC.md §2.1)
 *
 * Supabase が未設定でもモジュール読み込み時に throw しない方針にしている。
 * Supabase プロジェクト作成前でも `npm run dev` が起動できるようにするため、
 * 呼び出し側は hasSupabaseEnv() で分岐する。
 *
 * NEXT_PUBLIC_* はビルド時にインライン展開されるため、
 * 必ず `process.env.NEXT_PUBLIC_XXX` の完全な形で参照すること
 * (動的アクセスや分割代入では置換されない)。
 */

export const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL ?? "";
export const SUPABASE_ANON_KEY = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ?? "";

/** ブラウザ/サーバー共通の Supabase 環境変数が揃っているか */
export function hasSupabaseEnv(): boolean {
  return SUPABASE_URL.length > 0 && SUPABASE_ANON_KEY.length > 0;
}

/**
 * service role key。**サーバー専用**。クライアントに絶対露出させない。
 * 必須の経路からしか呼ばれないので、未設定なら throw する。
 */
export function requireServiceRoleKey(): string {
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!key) {
    throw new Error(
      "SUPABASE_SERVICE_ROLE_KEY が未設定です。.env.local を確認してください (SPEC §2.1)",
    );
  }
  return key;
}

/**
 * ics の UID ドメイン・購読URL生成に使う (SPEC §10)。未設定ならローカル既定。
 *
 * 手入力される値なので、ありがちな2つの揺れを吸収する:
 *   - 末尾スラッシュ … 購読URL生成で `...app//api/cal/...` と二重になる
 *   - スキーム無し   … Vercel の環境変数に `xxx.vercel.app` とだけ入れがち
 */
export function appBaseUrl(): string {
  const raw = (process.env.APP_BASE_URL ?? "http://localhost:3000").trim();
  const trimmed = raw.replace(/\/+$/, "");
  return /^https?:\/\//i.test(trimmed) ? trimmed : `https://${trimmed}`;
}

/**
 * APP_BASE_URL のホスト部分。ics の UID に使う (例: `slot-{id}@{host}`)。
 *
 * **ここでエラーを握り潰してはならない。** UID は恒久固定が最重要ルールで
 * (SPEC §10)、誤ったホストのまま購読URLを配ると、後で直したときに
 * 購読者全員のカレンダーで予定が重複する。しかも購読者側で登録し直すまで
 * 直らない。設定ミスは黙って動かすより、落として気付かせるほうが安全。
 */
export function appHost(): string {
  const base = appBaseUrl();
  try {
    return new URL(base).host;
  } catch {
    throw new Error(
      `APP_BASE_URL が URL として不正です: ${JSON.stringify(base)} — https://example.com の形式で設定してください (SPEC §2.1)`,
    );
  }
}

/** Vercel Cron 認証用 (SPEC §8.8 / §13.4) */
export function cronSecret(): string | undefined {
  return process.env.CRON_SECRET || undefined;
}

/**
 * Web Push の公開鍵 (SPEC §6.6)。**ブラウザに渡す前提の値**で、秘密ではない。
 * 購読を作るときに `applicationServerKey` として要る。
 */
export const VAPID_PUBLIC_KEY = process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY ?? "";

/**
 * Web Push の送信に必要な3点 (SPEC §6.6)。**サーバー専用**。
 *
 * 揃っていなければ null を返し、呼び出し側は通知を「送らない」で済ませる。
 * 通知は本体機能の付随物なので、鍵が未設定というだけで練習日程の公開や
 * 鍵の切り替えそのものが失敗してはいけない。
 */
export function vapidConfig(): {
  publicKey: string;
  privateKey: string;
  subject: string;
} | null {
  const privateKey = process.env.VAPID_PRIVATE_KEY ?? "";
  const subject = process.env.VAPID_SUBJECT ?? "";
  if (!VAPID_PUBLIC_KEY || !privateKey || !subject) return null;
  return { publicKey: VAPID_PUBLIC_KEY, privateKey, subject };
}
