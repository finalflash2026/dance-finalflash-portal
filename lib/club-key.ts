/**
 * 部室の鍵の所持ボードの共通部分 (SPEC.md §6.1.2)
 *
 * **サーバー(タブ①のページ)とクライアント(ボード)の両方から使う**ので、
 * `"use client"` の付いたファイルには置けない。クライアント側の関数は
 * サーバーから呼べず、実行時に
 * 「Attempted to call toRows() from the server」で画面ごと落ちる
 * (型検査もビルドも通ってしまうため、ここに分けておくこと)。
 */

export interface KeyHolderRow {
  id: string;
  userId: string;
  username: string;
  takenAt: string;
}

/** 折りたたみに出す履歴の件数。たどれれば十分なので深追いしない */
export const KEY_HISTORY_LIMIT = 5;

/** `id, user_id, taken_at, profiles(username)` の取得結果を画面用に整える */
export function toKeyHolderRows(data: unknown): KeyHolderRow[] {
  return (
    (data ?? []) as unknown as {
      id: string;
      user_id: string;
      taken_at: string;
      profiles: { username: string } | null;
    }[]
  ).map((row) => ({
    id: row.id,
    userId: row.user_id,
    username: row.profiles?.username ?? "(退会したユーザー)",
    takenAt: row.taken_at,
  }));
}
