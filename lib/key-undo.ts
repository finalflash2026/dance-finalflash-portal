/**
 * 鍵の報告の取り消し (SPEC §6.1.1 / §6.1.2 / v1.50.4)。
 *
 * 報告すると画面の下に「取り消す」を UNDO_WINDOW_MS だけ出す。
 * **通知はサーバーがそのあいだ待ってから送り**、取り消されていたら送らない。
 * サーバーは、通信の遅れを見込んで UNDO_ACCEPT_MS まで取り消しを受け付ける。
 */
export const UNDO_WINDOW_MS = 8_000;
export const UNDO_ACCEPT_MS = 30_000;
/** 通知を送る前に待つ時間。取り消しが届くまでの遅れを少し足す */
export const NOTIFY_DELAY_MS = UNDO_WINDOW_MS + 2_000;

export function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
