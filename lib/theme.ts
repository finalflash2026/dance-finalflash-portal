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

/**
 * `system` (v1.30 §6.7.8) は**端末の設定に合わせる**。iPhone の外観の自動切り替え
 * (夜だけダーク) をそのまま使いたい人のため。保存されるのは選択そのもので、
 * 実際に塗る色 (light / dark) はその都度 `prefers-color-scheme` から決める。
 */
export type Theme = "light" | "dark" | "system";
export type ResolvedTheme = "light" | "dark";

export const THEME_STORAGE_KEY = "app-theme";

export const THEME_LABELS: Record<Theme, string> = {
  system: "自動",
  light: "ライト",
  dark: "ダーク",
};

export const THEME_HINTS: Record<Theme, string> = {
  system: "端末の設定(外観モード) に合わせて切り替わります",
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
const THEME_COLORS: Record<ResolvedTheme, string> = {
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
export const THEME_INIT_SCRIPT = `try{var s=localStorage.getItem(${JSON.stringify(THEME_STORAGE_KEY)});var q=window.matchMedia("(prefers-color-scheme: dark)");var f=function(){var t=s==="dark"?"dark":s==="system"?(q.matches?"dark":"light"):"light";if(t==="dark"){document.documentElement.dataset.theme="dark"}else{delete document.documentElement.dataset.theme}var m=document.querySelector('meta[name="theme-color"]');if(!m){m=document.createElement("meta");m.name="theme-color";document.head.appendChild(m)}m.content=t==="dark"?${JSON.stringify(THEME_COLORS.dark)}:${JSON.stringify(THEME_COLORS.light)}};f();q.addEventListener("change",function(){s=localStorage.getItem(${JSON.stringify(THEME_STORAGE_KEY)});if(s==="system")f()})}catch(e){}`;

/**
 * `<html>` に反映する。ライトは属性を消す。
 *
 * **CSS 側の素の `:root` はライト**。ダークは属性が付いたときだけ効く形なので、
 * 既定を切り替えるのは上の script と readStoredTheme だけで済む
 * (v1.17 でダーク、v1.39 でライトに戻した)。
 * CSS の役割を入れ替えると、全トークンを書き直すことになる。
 */
export function applyTheme(choice: Theme): void {
  const theme = resolveTheme(choice);
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

/** 「自動」を実際の明暗に直す。それ以外はそのまま */
export function resolveTheme(choice: Theme): ResolvedTheme {
  if (choice !== "system") return choice;
  return window.matchMedia("(prefers-color-scheme: dark)").matches
    ? "dark"
    : "light";
}

/**
 * 保存済みの選択。**未設定・壊れた値はライト扱い**(v1.39。v1.17〜v1.38 はダーク)。
 *
 * 判定は「`dark` と保存されているか」で見る。自分でダークを選んだ人は
 * `dark` が保存されているので、この変更では変わらない。
 */
export function readStoredTheme(): Theme {
  try {
    const stored = localStorage.getItem(THEME_STORAGE_KEY);
    return stored === "dark" || stored === "system" ? stored : "light";
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
