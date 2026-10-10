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
type Result = { data: unknown; error: null; count?: number };

function builder(single = false): unknown {
  const result: Result = { data: single ? null : [], error: null, count: 0 };
  const handler: ProxyHandler<object> = {
    get(_target, prop) {
      if (prop === "then") {
        return (resolve: (value: Result) => void) => resolve(result);
      }
      if (prop === "single" || prop === "maybeSingle") {
        return () => builder(true);
      }
      // select / eq / order / insert / update / delete / upsert … どれも同じものを返す
      return () => builder(single);
    },
  };
  return new Proxy({}, handler);
}

export function createDemoClient() {
  return {
    from: () => builder(),
    auth: {
      getUser: async () => ({ data: { user: null }, error: null }),
      updateUser: async () => ({ data: { user: null }, error: null }),
      signInWithPassword: async () => ({ data: {}, error: null }),
    },
  } as unknown;
}
