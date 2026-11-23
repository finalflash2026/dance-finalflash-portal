import type { PostgrestError } from "@supabase/supabase-js";

/**
 * 1000行を超える読み出しを、ページに分けて全部読む (SPEC.md §13.1 / v1.50.2)
 *
 * Supabase (PostgREST) は1回の問い合わせで**最大1000行**しか返さず、超えたぶんは
 * エラーにならずに黙って欠ける。件数が増えうる読み出しはこれを通す。
 *
 * - `build(from, to)` は `.range(from, to)` を付けた問い合わせを返すこと
 * - **並び順を必ず付ける** (付けないとページの境目で行が重なったり抜けたりする)
 * - 念のため上限のページ数を超えたらエラーにする (無限に読み続けない)
 */
export const PAGE_SIZE = 1000;
const MAX_PAGES = 50;

export async function selectAll<T>(
  build: (from: number, to: number) => PromiseLike<{ data: T[] | null; error: PostgrestError | null }>,
): Promise<{ data: T[]; error: PostgrestError | null }> {
  const rows: T[] = [];
  for (let page = 0; page < MAX_PAGES; page += 1) {
    const from = page * PAGE_SIZE;
    const { data, error } = await build(from, from + PAGE_SIZE - 1);
    if (error) return { data: rows, error };
    rows.push(...(data ?? []));
    if ((data ?? []).length < PAGE_SIZE) return { data: rows, error: null };
  }
  return {
    data: rows,
    error: {
      name: "PostgrestError",
      code: "TOO_MANY_ROWS",
      message: `${MAX_PAGES * PAGE_SIZE}行を超えたので読むのをやめました`,
      details: "",
      hint: "",
    } as PostgrestError,
  };
}
