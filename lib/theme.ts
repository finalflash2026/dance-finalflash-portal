/**
 * 表示テーマ (SPEC.md §12 / §6.4.1 / v1.13)
 *
 * ライト(白ベース)とダーク(グレーベース)の2種類。
 * 実際の色は app/globals.css のトークンが持ち、ここは**どちらを選んだか**だけを扱う。
 *
 * 選択は端末ごとの好みなので **localStorage に持つ**(DBには入れない)。
 * サーバーは選択を知らないため、描画後に切り替わるちらつきを避ける目的で、
 * app/layout.tsx が最初のペイント前に `<html data-theme>` を立てる。
 */

export type Theme = "light" | "dark";

export const THEME_STORAGE_KEY = "app-theme";

export const THEME_LABELS: Record<Theme, string> = {
  light: "ライトモード",
  dark: "ダークモード",
};

export const THEME_HINTS: Record<Theme, string> = {
  light: "白い背景。明るい場所で見やすい",
  dark: "グレーの背景。暗い場所でまぶしくない",
};

/**
 * ブラウザ・OS 側に伝える地の色 (`<meta name="theme-color">`)。
 *
 * ホーム画面から開いたとき、**上端のステータスバーがこの色で塗られる**。
 * ここを固定にすると、ダークにしても上端だけ白く残る。
 * app/globals.css の --background と必ず同じ値にすること。
 */
const THEME_COLORS: Record<Theme, string> = {
  light: "#ffffff",
  dark: "#22272e",
};

/**
 * 最初のペイント前に走らせる script (app/layout.tsx が埋め込む)。
 *
 * **React の描画を待ってから切り替えるのでは間に合わない。**
 * 一瞬白い画面が出てからグレーになる、いわゆるちらつきが起きる。
 * localStorage が使えない設定でも落ちないよう try で囲む。
 *
 * theme-color の meta は **layout.tsx が静的に出したものを書き換える**
 * (無ければ作る)。静的に出しておかないと、ホーム画面から開いたときに
 * iOS がタグを見つけられず、マニフェストの background_color で
 * 上端を塗ってしまう。Next のメタタグはこの script より前に置かれるため、
 * ここで querySelector すれば必ず見つかる。
 */
export const THEME_INIT_SCRIPT = `try{var t=localStorage.getItem(${JSON.stringify(THEME_STORAGE_KEY)})==="dark"?"dark":"light";if(t==="dark"){document.documentElement.dataset.theme="dark"}var m=document.querySelector('meta[name="theme-color"]');if(!m){m=document.createElement("meta");m.name="theme-color";document.head.appendChild(m)}m.content=t==="dark"?${JSON.stringify(THEME_COLORS.dark)}:${JSON.stringify(THEME_COLORS.light)}}catch(e){}`;

/** `<html>` に反映する。ライトは属性を消す (既定がライトのため) */
export function applyTheme(theme: Theme): void {
  if (theme === "dark") {
    document.documentElement.dataset.theme = "dark";
  } else {
    delete document.documentElement.dataset.theme;
  }

  // ホーム画面から開いているときのステータスバーの色も合わせる
  let meta = document.querySelector<HTMLMetaElement>('meta[name="theme-color"]');
  if (!meta) {
    meta = document.createElement("meta");
    meta.name = "theme-color";
    document.head.appendChild(meta);
  }
  meta.content = THEME_COLORS[theme];
}

/** 保存済みの選択。未設定・壊れた値はライト扱い */
export function readStoredTheme(): Theme {
  try {
    return localStorage.getItem(THEME_STORAGE_KEY) === "dark" ? "dark" : "light";
  } catch {
    return "light";
  }
}

export function storeTheme(theme: Theme): void {
  try {
    localStorage.setItem(THEME_STORAGE_KEY, theme);
  } catch {
    // プライベートブラウズ等で保存できなくても、その場の切り替えは効かせる
  }
}
