/**
 * iOS アプリ (Capacitor の殻) の中で開かれているか (SPEC.md §2.3 / v1.37)
 *
 * アプリは本番の Web をそのまま開くので、画面のコードは Web と同じ。
 * アプリでだけ変える所 (Google でのログイン・通知の案内) がこれで分岐する。
 * Capacitor は読み込んだページに `window.Capacitor` を差し込む。
 */

/** アプリから Google でログインしたあとに戻ってくる URL (Info.plist の CFBundleURLSchemes) */
export const APP_URL_SCHEME = "ffcalendar";
export const APP_AUTH_CALLBACK = `${APP_URL_SCHEME}://auth/callback`;

type CapacitorGlobal = { isNativePlatform?: () => boolean };

export function isNativeApp(): boolean {
  if (typeof window === "undefined") return false;
  const cap = (window as Window & { Capacitor?: CapacitorGlobal }).Capacitor;
  return cap?.isNativePlatform?.() === true;
}

/**
 * アプリに戻ってきた URL を、WebView で開く場所に読み替える。
 * Google でのログイン以外の URL は null (何もしない)。
 */
export function appUrlToPath(appUrl: string): string | null {
  if (!appUrl.startsWith(APP_AUTH_CALLBACK)) return null;
  const params = new URL(appUrl.replace(`${APP_URL_SCHEME}://`, "https://app/"))
    .searchParams;
  const code = params.get("code");
  if (!code) return "/login?error=google";
  return `/auth/callback?code=${encodeURIComponent(code)}`;
}
