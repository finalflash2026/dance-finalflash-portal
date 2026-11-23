/**
 * ブラウザ側のプッシュ通知の登録 (SPEC.md §6.6 / §6.7.9)
 *
 * 設定画面 (PushSection) と、起動時の「通知をオンにする」案内 (LaunchPrompts)
 * の両方から使う。**許可を求めるのは、ボタンを押した直後だけ** (ブラウザの要件)。
 * 呼び出し側は必ずクリックの処理の中から呼ぶこと。
 */

/** ホーム画面に追加したアプリとして開いているか */
export function isStandalone(): boolean {
  return (
    window.matchMedia("(display-mode: standalone)").matches ||
    (navigator as Navigator & { standalone?: boolean }).standalone === true
  );
}

export function isIos(): boolean {
  return /iP(hone|ad|od)/.test(navigator.userAgent);
}

/** この端末・ブラウザで通知を受け取れるか (iOS の Safari タブでは false) */
export function canUsePush(vapidPublicKey: string): boolean {
  return (
    Boolean(vapidPublicKey) &&
    "serviceWorker" in navigator &&
    "PushManager" in window &&
    typeof Notification !== "undefined"
  );
}

/**
 * VAPID の公開鍵は base64url の文字列で渡されるが、
 * `pushManager.subscribe` はバイト列しか受け取らない。
 */
function toApplicationServerKey(base64Url: string): Uint8Array<ArrayBuffer> {
  const padding = "=".repeat((4 - (base64Url.length % 4)) % 4);
  const base64 = (base64Url + padding).replace(/-/g, "+").replace(/_/g, "/");
  const raw = window.atob(base64);
  // ArrayBuffer から作る。長さだけ渡すと SharedArrayBuffer も含む型になり、
  // subscribe() が受け取る BufferSource に合わない
  const output = new Uint8Array(new ArrayBuffer(raw.length));
  for (let i = 0; i < raw.length; i++) output[i] = raw.charCodeAt(i);
  return output;
}

/** この端末が既に登録済みか (ブラウザ側の購読の有無) */
export async function hasPushSubscription(): Promise<boolean> {
  const registration = await navigator.serviceWorker.getRegistration("/");
  if (!registration) return false;
  return (await registration.pushManager.getSubscription()) !== null;
}

/**
 * 許可を求めて購読を作り、サーバーに保存する。
 * @returns "granted" 以外は登録していない (理由をそのまま返す)
 */
export async function subscribePush(
  vapidPublicKey: string,
  prefs?: Record<string, boolean>,
): Promise<NotificationPermission> {
  const permission = await Notification.requestPermission();
  if (permission !== "granted") return permission;

  const registration = await navigator.serviceWorker.register("/sw.js");
  await navigator.serviceWorker.ready;
  const subscription = await registration.pushManager.subscribe({
    // false は許されない (バックグラウンドで黙って動く用途を塞ぐため)
    userVisibleOnly: true,
    applicationServerKey: toApplicationServerKey(vapidPublicKey),
  });
  await savePushSubscription(subscription, prefs);
  return permission;
}

/** 購読とカテゴリの設定をサーバーへ保存する (切り替えも同じ入口) */
export async function savePushSubscription(
  subscription: PushSubscription,
  prefs?: Record<string, boolean>,
): Promise<void> {
  const json = subscription.toJSON() as {
    keys?: { p256dh?: string; auth?: string };
  };
  const res = await fetch("/api/push/subscribe", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      endpoint: subscription.endpoint,
      keys: { p256dh: json.keys?.p256dh, auth: json.keys?.auth },
      ...(prefs ? { prefs } : {}),
    }),
  });
  if (!res.ok) {
    const body = (await res.json().catch(() => null)) as { error?: string } | null;
    throw new Error(body?.error ?? "保存できませんでした");
  }
}
