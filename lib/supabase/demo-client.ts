/**
 * 見た目確認用のダミー Supabase クライアント (デモ画面 `/demo` 用)
 *
 * **Supabase が設定されていない手元の環境でだけ使われる** (lib/supabase/client.ts)。
 * 本番・プレビューは環境変数が入っているので、ここを通ることは無い。
 *
 * どんな呼び出しにも「成功・中身は空」で答える。画面の部品は自前で
 * 取り直し (鍵のボードの15秒ごとの再取得など) をするが、デモでは
 * サーバーが無いので、エラーを出さずに見本のデータのまま表示させたい。
 */
import { demoRows } from "@/lib/supabase/demo-data";

type Result = { data: unknown; error: null; count?: number };
type Filter = (row: Record<string, unknown>) => boolean;

/**
 * 読み出し (select) のときだけ見本の行を返す (v1.31.13。折衝・管理者のデモ用)。
 * eq / neq / gte / lte / in だけを当てはめ、それ以外の条件は無視する。
 * 書き込み (insert / update / delete / upsert) は何もせず成功で答える。
 */
function builder(table: string, single = false, filters: Filter[] = [], write = false): unknown {
  const result = (): Result => {
    if (write) return { data: single ? null : [], error: null, count: 0 };
    const rows = demoRows(table).filter((row) => filters.every((f) => f(row)));
    return { data: single ? (rows[0] ?? null) : rows, error: null, count: rows.length };
  };
  const handler: ProxyHandler<object> = {
    get(_target, prop) {
      if (prop === "then") {
        return (resolve: (value: Result) => void) => resolve(result());
      }
      if (prop === "single" || prop === "maybeSingle") {
        return () => builder(table, true, filters, write);
      }
      if (prop === "insert" || prop === "update" || prop === "delete" || prop === "upsert") {
        return () => builder(table, single, filters, true);
      }
      const compare: Record<string, (a: unknown, b: unknown) => boolean> = {
        eq: (a, b) => a === b,
        neq: (a, b) => a !== b,
        gte: (a, b) => String(a) >= String(b),
        lte: (a, b) => String(a) <= String(b),
        in: (a, b) => Array.isArray(b) && b.includes(a),
      };
      if (typeof prop === "string" && prop in compare) {
        return (column: string, value: unknown) =>
          builder(
            table,
            single,
            [...filters, (row) => !(column in row) || compare[prop](row[column], value)],
            write,
          );
      }
      // select / order / limit / or … は同じものを返す
      return () => builder(table, single, filters, write);
    },
  };
  return new Proxy({}, handler);
}

export function createDemoClient() {
  return {
    from: (table: string) => builder(table),
    auth: {
      getUser: async () => ({ data: { user: null }, error: null }),
      updateUser: async () => ({ data: { user: null }, error: null }),
      signInWithPassword: async () => ({ data: {}, error: null }),
    },
  } as unknown;
}
