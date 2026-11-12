import type { CapacitorConfig } from "@capacitor/cli";

/**
 * iOS アプリの殻の設定 (SPEC.md §2.3 / v1.37)
 *
 * アプリは WKWebView で**本番の Web をそのまま開く**。画面はすべて Web と同じ
 * コードなので、Web をデプロイすればアプリにも出る。
 *
 * 開く先は `npx cap sync` の時点で決まり、`ios/App/App/capacitor.config.json`
 * に書き込まれる。ふだんは `npm run ios:sync` / `npm run ios:dev`
 * (scripts/cap.mjs) から呼ぶ。
 *   CAP_SERVER_URL → APP_BASE_URL → 本番の既定 の順。
 */
const PRODUCTION_URL = "https://finalflash-portal-demo.vercel.app";

const serverUrl = (
  process.env.CAP_SERVER_URL ||
  process.env.APP_BASE_URL ||
  PRODUCTION_URL
).replace(/\/+$/, "");

const config: CapacitorConfig = {
  appId: "com.finalflash.ffcalendar",
  appName: "ff Calendar",
  // 開けなかったときに出す同梱のページだけを置く
  webDir: "native/www",
  // 起動画面と Web の起動アニメーション (components/Splash.tsx) の黒地に揃える。
  // 読み込み中に別の色が挟まると、黒→色→黒とちらつく
  backgroundColor: "#000000",
  // Web 側で見分けられるように (lib/native.ts)
  appendUserAgent: "ffCalendarApp",
  server: {
    url: serverUrl,
    // 手元の dev (http://localhost:3000 など) を開くときだけ
    cleartext: serverUrl.startsWith("http://"),
    errorPath: "offline.html",
  },
  ios: {
    // Web 側が viewport-fit=cover と safe-area で余白を取っている (app/layout.tsx)
    contentInset: "never",
  },
};

export default config;
