/**
 * DB・通信のエラーを、利用者が読める日本語にする (v1.32.6)。
 *
 * PostgREST / PostgreSQL のエラー文 (`new row violates row-level security policy …`)
 * をそのまま出すと、何が起きたのか・どうすればよいのかが分からない。
 * よくあるものはコードから言い換え、知らないものだけ詳細として後ろに添える
 * (問い合わせを受けたときに原因を追えるように)。
 */
export interface DbErrorLike {
  code?: string;
  message: string;
}

/** コード → 何が起きたか + どうすればよいか */
const BY_CODE: Record<string, string> = {
  "42501": "この操作をする権限がありません。ログインし直すか、担当の人に確認してください",
  "23505": "同じものが既にあります。画面を更新して確かめてください",
  "23514": "入力した値が条件に合っていません。時刻や日付を確かめてください",
  "23P01": "他の予定と時間が重なっています",
  "23503": "関係するデータが見つかりません(他の人が消したかもしれません)。画面を更新してください",
  PGRST116: "見つかりませんでした。他の人が消したかもしれません。画面を更新してください",
  PGRST301: "ログインの期限が切れました。ログインし直してください",
};

function isNetworkError(message: string): boolean {
  return /failed to fetch|networkerror|load failed|network request failed/i.test(message);
}

/**
 * `action` は「保存できませんでした」のような失敗の言い方。
 * 例: dbErrorMessage("保存できませんでした", error)
 *   → 「保存できませんでした。他の予定と時間が重なっています」
 */
export function dbErrorMessage(action: string, error: DbErrorLike): string {
  const known = error.code ? BY_CODE[error.code] : undefined;
  // エラーは文として読ませるので「。」で終える (§12 / v1.33.1)
  if (known) return `${action}。${known}。`;
  if (isNetworkError(error.message)) {
    return `${action}。通信できませんでした。電波の良いところでもう一度試してください。`;
  }
  if (/jwt expired/i.test(error.message)) {
    return `${action}。${BY_CODE.PGRST301}。`;
  }
  return `${action}。時間をおいてもう一度試してください(詳細: ${error.message})。`;
}
