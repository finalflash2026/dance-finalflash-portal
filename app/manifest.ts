import type { MetadataRoute } from "next";

/**
 * Web App Manifest (SPEC.md §12 / v1.13.1)
 *
 * ホーム画面に追加したときの見た目を決める。
 *   - `name` / `short_name` … アイコンの下に出る名前
 *   - `display: standalone` … Safari の URL バーやタブを出さずに開く
 *   - `background_color`   … 起動直後のスプラッシュの地色
 *
 * **iOS のアイコン自体はこの manifest ではなく `app/apple-icon.png` が使われる。**
 * manifest 側の icons は Android や PC のブラウザ向け。両方置いておくこと。
 */
export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "ff Calendar",
    short_name: "ff Calendar",
    description: "練習日程・空き申請・ナンバーの管理サイト",
    start_url: "/",
    display: "standalone",
    // アイコンが黒地なので、起動時のスプラッシュも黒にして繋がって見せる
    background_color: "#000000",
    theme_color: "#ffffff",
    icons: [
      { src: "/icon-192.png", sizes: "192x192", type: "image/png" },
      { src: "/icon-512.png", sizes: "512x512", type: "image/png" },
      // maskable: Android が独自の形に切り抜くときに使う。
      // 元画像は中央に余白があるので、切り抜かれてもロゴは残る
      {
        src: "/icon-512.png",
        sizes: "512x512",
        type: "image/png",
        purpose: "maskable",
      },
    ],
  };
}
