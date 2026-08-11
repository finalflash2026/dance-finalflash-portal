/**
 * username の組み立て (SPEC.md §1 / §3.2 / §6.5.1)
 *
 * username = `{期}{1ジャンコード}{名前}`  例: 22BREAKせいあ
 *
 * このファイルは Node 固有 API を使わない (クライアントでの入力プレビューにも使うため)。
 * ダミーメールの合成はサーバー専用なので lib/auth/email.ts に分離してある。
 */

import { GENRE_BY_ID, type GenreCode } from "@/lib/constants";

export function buildUsername(
  generation: number,
  genreCode: GenreCode | string,
  displayName: string,
): string {
  return `${generation}${genreCode}${displayName.trim()}`;
}

/** 1ジャンの id から username を組み立てる (DB の main_genre_id を渡す用) */
export function buildUsernameFromGenreId(
  generation: number,
  mainGenreId: number,
  displayName: string,
): string {
  const genre = GENRE_BY_ID.get(mainGenreId);
  if (!genre) {
    throw new Error(`未知のジャンルID: ${mainGenreId}`);
  }
  return buildUsername(generation, genre.code, displayName);
}
