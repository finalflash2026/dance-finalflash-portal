/**
 * 掲示板の連絡の型と変換 (SPEC.md §6.1.3 / v1.27)
 *
 * **`"use client"` のファイルに置かないこと。** サーバーコンポーネント
 * (overview/page.tsx) からも呼ぶため、クライアント側のモジュールに置くと
 * リクエスト時に落ちる。v1.12 で部室の鍵ボードが同じ形で本番を落としたので、
 * 素の関数はここへ切り出してある (lib/club-key.ts と同じ理由)。
 */

export interface BoardMessage {
  id: string;
  body: string;
  userId: string;
  username: string;
  createdAt: string;
}

/** 連絡の入力上限。長文は掲示板ではなくLINEでやってもらう */
export const MESSAGE_MAX_LENGTH = 300;

/** DBの行を画面用の形に。サーバー・クライアントの両方から呼ぶ */
export function toBoardMessages(rows: unknown): BoardMessage[] {
  return (
    (rows ?? []) as {
      id: string;
      body: string;
      user_id: string;
      created_at: string;
      profiles: { username: string } | null;
    }[]
  ).map((row) => ({
    id: row.id,
    body: row.body,
    userId: row.user_id,
    username: row.profiles?.username ?? "(不明)",
    createdAt: row.created_at,
  }));
}
