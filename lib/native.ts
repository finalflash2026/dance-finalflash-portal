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
/** ウィジェットを押したとき (SPEC §2.3.1 / v1.38) */
export const APP_OPEN_URL = `${APP_URL_SCHEME}://open`;

/** Capacitor の設定 (appendUserAgent) と同じ。サーバーの HTML でも見分けられる */
export const APP_USER_AGENT_MARK = "ffCalendarApp";

/**
 * 最初のペイント前に `<html class="native-app">` を立てる (app/layout.tsx)。
 * アプリでは Web のタブバーを描かない (ネイティブのものを重ねる) ので、
 * React が動く前から隠しておかないと一瞬2本見える。
 */
export const NATIVE_INIT_SCRIPT = `try{if(navigator.userAgent.indexOf(${JSON.stringify(
  "ffCalendarApp",
)})>=0){document.documentElement.classList.add("native-app")}}catch(e){}`;

/** アプリの中で開いてよい道順か (同じサイトの中だけ。`//` で外へ出さない) */
export function safeAppPath(path: string | null | undefined): string | null {
  if (!path || !path.startsWith("/") || path.startsWith("//")) return null;
  return path;
}

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
  // ウィジェットから: ffcalendar://open?path=/?date=… (SPEC §2.3.1 / v1.38)
  if (appUrl.startsWith(APP_OPEN_URL)) {
    const params = new URL(appUrl.replace(`${APP_URL_SCHEME}://`, "https://app/"))
      .searchParams;
    return safeAppPath(params.get("path"));
  }
  if (!appUrl.startsWith(APP_AUTH_CALLBACK)) return null;
  const params = new URL(appUrl.replace(`${APP_URL_SCHEME}://`, "https://app/"))
    .searchParams;
  const code = params.get("code");
  if (!code) return "/login?error=google";
  return `/auth/callback?code=${encodeURIComponent(code)}`;
}
