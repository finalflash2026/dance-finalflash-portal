/**
 * 短い知らせ (トースト。SPEC §12「動き」/ v1.36)。成功したことを画面の下に
 * 少しだけ出す (「出欠を登録しました」など)。描くのは components/ToastHost.tsx。
 *
 *   showToast("出欠を登録しました");
 */
type Listener = (message: string) => void;

let listener: Listener | null = null;

export function registerToastHost(fn: Listener | null) {
  listener = fn;
}

export function showToast(message: string) {
  listener?.(message);
}
