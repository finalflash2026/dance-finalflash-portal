/**
 * タブ遷移の向き (SPEC.md §12 / v1.14)
 *
 * 新しい画面を**どちら側から滑り込ませるか**だけを持つ。
 * 右のタブへ移ったなら右から、左のタブへ移ったなら左から入れる。
 *
 * **state ではなくモジュール変数**にしてある。書くのはタブのタップと
 * スワイプ、読むのは遷移先の画面で、両者は別のコンポーネントとして
 * 別々に描画される。React の state で渡そうとすると、値を運ぶためだけの
 * Context とプロバイダが要る。
 *
 * 1回の遷移で使い切る使い捨ての値なので、読んだ側が消す (takeNavDirection)。
 * URL直打ちやブラウザの戻るでは何も入っていないため、向きなし = フェードになる。
 */

export type NavDirection = "left" | "right" | null;

let pending: NavDirection = null;

/** タブの index から向きを決めて覚える。同じタブなら何もしない */
export function rememberNavDirection(from: number, to: number): void {
  if (from < 0 || from === to) {
    pending = null;
    return;
  }
  pending = to > from ? "right" : "left";
}

/** 覚えていた向きを取り出して消す */
export function takeNavDirection(): NavDirection {
  const value = pending;
  pending = null;
  return value;
}
