import "server-only";

/**
 * DB エラーメッセージのサニタイズ (脆弱性対策 M-3)
 *
 * Supabase のエラーメッセージにはテーブル名・カラム名・PostgreSQL の
 * 内部情報が含まれることがある。これをそのままクライアントに返すと、
 * 攻撃者にスキーマの手がかりを与えてしまう。
 *
 * - **本番**: 汎用メッセージだけを返し、詳細はサーバーログに残す
 * - **開発**: デバッグのため詳細をそのまま返す
 */
const isDev = process.env.NODE_ENV === "development";

/**
 * DB 接続エラー用。「DBに接続できませんでした」系のメッセージに使う。
 *
 * @param detail  Supabase error.message などの生のエラー文字列
 * @param context ログに残す操作名 (例: "合言葉の照合")
 */
export function dbError(detail: string, context?: string): string {
  if (!isDev) {
    console.error(
      `[db-error]${context ? ` ${context}:` : ""} ${detail}`,
    );
  }
  return isDev
    ? `DBに接続できませんでした: ${detail}`
    : "サーバーエラーが発生しました。しばらく待ってからやり直してください";
}

/**
 * 操作失敗エラー用。「〜に失敗しました」系のメッセージに使う。
 *
 * @param action  何に失敗したか (例: "登録", "更新")
 * @param detail  Supabase error.message などの生のエラー文字列
 * @param context ログに残す操作名
 */
export function operationError(
  action: string,
  detail: string,
  context?: string,
): string {
  if (!isDev) {
    console.error(
      `[op-error]${context ? ` ${context}:` : ""} ${action}: ${detail}`,
    );
  }
  return isDev
    ? `${action}に失敗しました: ${detail}`
    : `${action}に失敗しました。しばらく待ってからやり直してください`;
}
