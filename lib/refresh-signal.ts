/**
 * 「今すぐ取り直して」の合図 (SPEC.md §12 / v1.16)
 *
 * 引っぱって更新 (PullToRefresh) から使う。**`router.refresh()` だけでは
 * 足りない**ため、これと対で投げる。
 *
 * サーバーコンポーネントは `router.refresh()` で描き直せるが、施錠ボードと
 * 部室の鍵ボードは**自分で Supabase を引いて state に持っている**。
 * 再描画されても props の初期値は state に入り直さない (useState の初期値は
 * 再レンダーでは効かない) ので、引っぱっても値が変わらないように見える。
 *
 * window のイベントにしてあるのは、送る側 (画面の一番外側) と受ける側
 * (カレンダーの奥にあるカード) が親子関係に無いため。Context を通すには
 * 途中の全部をクライアントコンポーネントにする必要がある。
 */

export const REFRESH_EVENT = "ff:refresh";

/** 自前で取り直しているカードたちに合図する */
export function requestRefresh(): void {
  window.dispatchEvent(new Event(REFRESH_EVENT));
}
