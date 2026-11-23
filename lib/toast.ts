/**
 * 短い知らせ (トースト。SPEC §12「動き」/ v1.36)。成功したことを画面の下に
 * 少しだけ出す (「出欠を登録しました」など)。描くのは components/ToastHost.tsx。
 *
 *   showToast("出欠を登録しました");
 *   showToast("開けたと報告しました", { action: { label: "取り消す", run: undo }, durationMs: 8000 });
 *
 * action を付けると、押せるボタンを添えて長めに出す (v1.50.4。鍵の報告の取り消し)
 */
export interface ToastOptions {
  action?: { label: string; run: () => void };
  durationMs?: number;
}

type Listener = (message: string, options: ToastOptions) => void;

let listener: Listener | null = null;

export function registerToastHost(fn: Listener | null) {
  listener = fn;
}

export function showToast(message: string, options: ToastOptions = {}) {
  listener?.(message, options);
}
