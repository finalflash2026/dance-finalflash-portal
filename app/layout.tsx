import type { Metadata, Viewport } from "next";

import { THEME_INIT_SCRIPT } from "@/lib/theme";

import "./globals.css";

export const metadata: Metadata = {
  title: "ダンスサークル練習管理",
  description: "練習日程・空き申請・ナンバーの管理サイト",
  /*
   * ホーム画面に追加したときの挙動 (SPEC §12 / v1.13.1)。
   *   capable       … Safari のバーを出さずに開く (manifest の standalone と対)
   *   title         … アイコンの下に出る名前。**ブラウザのタブ名とは別**
   *   statusBarStyle… 上端のステータスバー。default は地の色に合わせて描かれる
   * アイコン自体は app/apple-icon.png を Next が自動で link に出す。
   */
  appleWebApp: {
    capable: true,
    title: "ff Calendar",
    statusBarStyle: "default",
  },
};

// スマホ最優先 (SPEC §12)。下部固定タブバーのため viewport-fit も指定する
export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  maximumScale: 1,
  viewportFit: "cover",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    /*
     * テーマの選択は端末の localStorage にあり、サーバーは知らない。
     * そのためサーバーが返す HTML には data-theme が無く、
     * 下の script が最初のペイント前に立てる (SPEC §12 / v1.13)。
     * suppressHydrationWarning は、その差分を React に警告させないため。
     */
    <html lang="ja" suppressHydrationWarning>
      <head>
        <script dangerouslySetInnerHTML={{ __html: THEME_INIT_SCRIPT }} />
      </head>
      <body className="antialiased">{children}</body>
    </html>
  );
}
